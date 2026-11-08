package app.sakina.duas;

import android.app.AlarmManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;

/**
 * Morning / evening adhkar that start by themselves at a set time, even when Sakina is closed:
 * an exact alarm wakes AdhkarAlarm, which starts AdhkarService to play the playlist natively.
 */
@CapacitorPlugin(name = "Adhkar")
public class AdhkarPlugin extends Plugin {

    /** slots: [{ key, on, hour, minute, title, items: [{ path, start, end, repeat, title }] }] */
    @PluginMethod
    public void schedule(PluginCall call) {
        JSArray slots = call.getArray("slots", new JSArray());
        AdhkarAlarm.save(getContext(), slots.toString());
        AdhkarAlarm.armAll(getContext());
        JSObject r = new JSObject();
        r.put("exact", AdhkarAlarm.canExact(getContext()));
        call.resolve(r);
    }

    /** Start a slot now (for testing from Settings). */
    @PluginMethod
    public void playNow(PluginCall call) {
        try { AdhkarAlarm.startSlot(getContext(), call.getString("key", "morning")); call.resolve(); }
        catch (Exception e) { call.reject(e.getMessage()); }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent i = new Intent(getContext(), AdhkarService.class).setAction(AdhkarService.ACTION_STOP);
        try { if (AdhkarService.running) getContext().startService(i); } catch (Exception ignored) { }
        call.resolve();
    }

    /** Your own audio (imported packs) lives in the WebView's storage; copy a clip to a file the player can read. */
    @PluginMethod
    public void saveClip(PluginCall call) {
        String name = call.getString("name", "");
        String data = call.getString("data", "");
        if (name.isEmpty() || name.contains("/") || name.contains("..")) { call.reject("bad name"); return; }
        try {
            File dir = new File(getContext().getFilesDir(), "adhkar");
            if (!dir.exists()) dir.mkdirs();
            File f = new File(dir, name);
            try (FileOutputStream out = new FileOutputStream(f)) { out.write(Base64.decode(data, Base64.DEFAULT)); }
            JSObject r = new JSObject();
            r.put("path", f.getAbsolutePath());
            call.resolve(r);
        } catch (Exception e) { call.reject("Could not save clip: " + e.getMessage()); }
    }

    @PluginMethod
    public void hasClip(PluginCall call) {
        File f = new File(new File(getContext().getFilesDir(), "adhkar"), call.getString("name", "-"));
        JSObject r = new JSObject();
        r.put("exists", f.exists() && f.length() > 0);
        r.put("path", f.getAbsolutePath());
        call.resolve(r);
    }

    @PluginMethod
    public void canExact(PluginCall call) {
        JSObject r = new JSObject();
        r.put("exact", AdhkarAlarm.canExact(getContext()));
        call.resolve(r);
    }

    /** Opens the system page where "Alarms & reminders" can be allowed (Android 12+). */
    @PluginMethod
    public void openExactSettings(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= 31) {
                Intent i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getContext().getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
            }
            call.resolve();
        } catch (Exception e) { call.reject(e.getMessage()); }
    }
}
