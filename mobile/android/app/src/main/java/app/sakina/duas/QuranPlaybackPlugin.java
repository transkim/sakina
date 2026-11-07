package app.sakina.duas;

import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Keeps Quran recitation going when Sakina is in the background:
 * a media-playback foreground service with a notification (pause / play / stop).
 */
@CapacitorPlugin(name = "QuranPlayback")
public class QuranPlaybackPlugin extends Plugin {
    static QuranPlaybackPlugin instance;

    @Override
    public void load() { instance = this; }

    @Override
    protected void handleOnDestroy() { if (instance == this) instance = null; }

    @PluginMethod
    public void update(PluginCall call) {
        Intent i = new Intent(getContext(), QuranPlaybackService.class);
        i.setAction(QuranPlaybackService.ACTION_UPDATE);
        i.putExtra("title", call.getString("title", "Quran"));
        i.putExtra("text", call.getString("text", ""));
        i.putExtra("playing", call.getBoolean("playing", true));
        try {
            // once the service is in the foreground, plain updates are allowed even from the background
            if (Build.VERSION.SDK_INT >= 26 && !QuranPlaybackService.running) getContext().startForegroundService(i);
            else getContext().startService(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not start background playback: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), QuranPlaybackService.class));
        call.resolve();
    }

    static void sendAction(String action) {
        QuranPlaybackPlugin p = instance;
        if (p == null) return;
        JSObject data = new JSObject();
        data.put("action", action);
        p.notifyListeners("action", data);
    }
}
