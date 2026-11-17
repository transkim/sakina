package app.sakina.duas;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;

/** Saves Quran recitation files on the phone so they play without internet. */
@CapacitorPlugin(name = "QuranAudio")
public class QuranAudioPlugin extends Plugin {
    private final AtomicBoolean cancel = new AtomicBoolean(false);

    private File root() { return new File(getContext().getFilesDir(), "quran"); }

    private static boolean safe(String s) { return s != null && !s.isEmpty() && !s.contains("/") && !s.contains(".."); }

    @PluginMethod
    public void list(PluginCall call) {
        String reciter = call.getString("reciter");
        JSObject r = new JSObject();
        r.put("dir", root().getAbsolutePath());
        JSArray files = new JSArray();
        long bytes = 0;
        if (safe(reciter)) {
            File[] fs = new File(root(), reciter).listFiles();
            if (fs != null) for (File f : fs) {
                if (f.getName().endsWith(".mp3") && f.length() > 0) { files.put(f.getName()); bytes += f.length(); }
            }
        }
        r.put("files", files);
        r.put("bytes", bytes);
        call.resolve(r);
    }

    /** items: [{ name, url, alt? }] — downloads 4 at a time, skips files already saved, emits "progress". */
    @PluginMethod
    public void download(PluginCall call) {
        String reciter = call.getString("reciter");
        JSArray items = call.getArray("items", new JSArray());
        if (!safe(reciter)) { call.reject("bad reciter"); return; }
        File dir = new File(root(), reciter);
        if (!dir.exists()) dir.mkdirs();
        cancel.set(false);
        final int total = items.length();
        AtomicInteger done = new AtomicInteger(0), failed = new AtomicInteger(0);
        new Thread(() -> {
            ExecutorService pool = Executors.newFixedThreadPool(4);
            for (int i = 0; i < total; i++) {
                final JSONObject it = items.optJSONObject(i);
                pool.execute(() -> {
                    if (cancel.get() || it == null) return;
                    String name = it.optString("name");
                    boolean ok = false;
                    if (safe(name)) {
                        File out = new File(dir, name);
                        ok = out.exists() && out.length() > 0;
                        if (!ok) ok = fetch(it.optString("url"), out);
                        if (!ok && it.has("alt") && !it.isNull("alt")) ok = fetch(it.optString("alt"), out);
                    }
                    if (!ok) failed.incrementAndGet();
                    int d = done.incrementAndGet();
                    JSObject p = new JSObject();
                    p.put("reciter", reciter); p.put("done", d); p.put("total", total); p.put("failed", failed.get());
                    notifyListeners("progress", p);
                });
            }
            pool.shutdown();
            try { pool.awaitTermination(6, TimeUnit.HOURS); } catch (InterruptedException ignored) { }
            JSObject r = new JSObject();
            r.put("done", done.get()); r.put("failed", failed.get()); r.put("cancelled", cancel.get());
            call.resolve(r);
        }).start();
    }

    private boolean fetch(String url, File out) {
        if (url == null || !url.startsWith("https://")) return false;
        File tmp = new File(out.getPath() + ".part");
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setInstanceFollowRedirects(true);
            if (c.getResponseCode() != 200) return false;
            try (InputStream in = c.getInputStream(); FileOutputStream fo = new FileOutputStream(tmp)) {
                byte[] buf = new byte[32768];
                int n;
                while ((n = in.read(buf)) > 0) { if (cancel.get()) return false; fo.write(buf, 0, n); }
            }
            return tmp.length() > 0 && tmp.renameTo(out);
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
            if (tmp.exists()) tmp.delete();
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) { cancel.set(true); call.resolve(); }

    /** names: [...] to delete some files, or none to delete the whole reciter. */
    @PluginMethod
    public void remove(PluginCall call) {
        String reciter = call.getString("reciter");
        if (!safe(reciter)) { call.reject("bad reciter"); return; }
        File dir = new File(root(), reciter);
        JSArray names = call.getArray("names", null);
        if (names != null) {
            for (int i = 0; i < names.length(); i++) {
                String n = names.optString(i);
                if (safe(n)) new File(dir, n).delete();
            }
        } else {
            File[] fs = dir.listFiles();
            if (fs != null) for (File f : fs) f.delete();
            dir.delete();
        }
        call.resolve();
    }
}
