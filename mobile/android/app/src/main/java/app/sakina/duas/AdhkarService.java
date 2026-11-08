package app.sakina.duas;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import org.json.JSONArray;
import org.json.JSONObject;

/** Plays the morning or evening adhkar one after another (each repeated its set number of times), with no screen needed. */
public class AdhkarService extends Service {
    static final String ACTION_START = "app.sakina.duas.ADHKAR_START";
    static final String ACTION_PAUSE = "app.sakina.duas.ADHKAR_PAUSE";
    static final String ACTION_PLAY = "app.sakina.duas.ADHKAR_PLAY";
    static final String ACTION_STOP = "app.sakina.duas.ADHKAR_STOP";
    private static final String CHANNEL = "adhkar_auto";
    private static final int ID = 7115;

    static volatile boolean running = false;
    private final Handler h = new Handler(Looper.getMainLooper());
    private MediaPlayer mp;
    private JSONArray items = new JSONArray();
    private String title = "Adhkar";
    private int index = 0, rep = 0;
    private boolean paused = false;
    private PowerManager.WakeLock wake;
    private AudioManager am;
    private AudioFocusRequest focus;

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) { finish(); return START_NOT_STICKY; }
        if (ACTION_PAUSE.equals(action)) { paused = true; if (mp != null) try { mp.pause(); } catch (Exception ignored) { } notifyNow(); return START_NOT_STICKY; }
        if (ACTION_PLAY.equals(action)) { paused = false; if (mp != null) try { mp.start(); } catch (Exception ignored) { } notifyNow(); return START_NOT_STICKY; }

        // ACTION_START: go to the foreground straight away (required within a few seconds)
        String key = intent != null ? intent.getStringExtra("key") : "morning";
        JSONObject slot = AdhkarAlarm.slot(this, key == null ? "morning" : key);
        title = slot != null ? slot.optString("title", "Adhkar") : "Adhkar";
        items = slot != null && slot.optJSONArray("items") != null ? slot.optJSONArray("items") : new JSONArray();
        startFg(build("Starting…"));
        running = true;
        if (items.length() == 0) { finish(); return START_NOT_STICKY; }
        stopPlayer();
        index = 0; rep = 0; paused = false;
        wake();
        requestFocus();
        playCurrent();
        return START_NOT_STICKY;
    }

    private void startFg(Notification n) {
        if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(ID, n);
    }

    private String currentTitle() {
        JSONObject it = items.optJSONObject(index);
        if (it == null) return "";
        int times = Math.max(1, it.optInt("repeat", 1));
        return it.optString("title", "") + (times > 1 ? "  (" + (rep + 1) + "/" + times + ")" : "");
    }

    private void playCurrent() {
        h.removeCallbacks(endCheck);
        if (index >= items.length()) { finish(); return; }
        JSONObject it = items.optJSONObject(index);
        try {
            stopPlayer();
            mp = new MediaPlayer();
            mp.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            String path = it.optString("path");
            if (path.startsWith("/")) mp.setDataSource(path);
            else {
                try (AssetFileDescriptor fd = getAssets().openFd(path)) { mp.setDataSource(fd.getFileDescriptor(), fd.getStartOffset(), fd.getLength()); }
            }
            mp.setOnCompletionListener(p -> next());
            mp.setOnErrorListener((p, w, e) -> { skip(); return true; });
            mp.prepare();
            int start = (int) Math.round(it.optDouble("start", 0) * 1000);
            if (start > 0) mp.seekTo(start);
            if (!paused) mp.start();
            if (!it.isNull("end") && it.has("end")) h.postDelayed(endCheck, 200);
            notifyNow();
        } catch (Exception e) {
            skip();
        }
    }

    // a clip cut from a longer recording stops at its end time
    private final Runnable endCheck = new Runnable() {
        @Override public void run() {
            JSONObject it = items.optJSONObject(index);
            if (mp == null || it == null) return;
            try {
                double end = it.optDouble("end", -1);
                if (end > 0 && mp.getCurrentPosition() >= end * 1000) { next(); return; }
            } catch (Exception ignored) { }
            h.postDelayed(this, 200);
        }
    };

    private void next() {
        JSONObject it = items.optJSONObject(index);
        int times = it == null ? 1 : Math.max(1, it.optInt("repeat", 1));
        if (++rep < times) { replay(); return; }
        rep = 0; index++;
        h.post(this::playCurrent);
    }

    private void replay() {
        JSONObject it = items.optJSONObject(index);
        try {
            mp.seekTo((int) Math.round((it == null ? 0 : it.optDouble("start", 0)) * 1000));
            if (!paused) mp.start();
            notifyNow();
        } catch (Exception e) { h.post(this::playCurrent); }
    }

    private void skip() { rep = 0; index++; h.post(this::playCurrent); }

    private void notifyNow() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        nm.notify(ID, build(currentTitle()));
    }

    private Notification build(String text) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Morning and evening adhkar", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while the adhkar play by themselves at the time you chose");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        int pf = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(this, 10, open, pf);
        PendingIntent toggle = PendingIntent.getService(this, 11, new Intent(this, AdhkarService.class).setAction(paused ? ACTION_PLAY : ACTION_PAUSE), pf);
        PendingIntent stop = PendingIntent.getService(this, 12, new Intent(this, AdhkarService.class).setAction(ACTION_STOP), pf);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_sakina)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(content)
            .setOngoing(!paused)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .addAction(0, paused ? "Play" : "Pause", toggle)
            .addAction(0, "Stop", stop)
            .setStyle(new androidx.media.app.NotificationCompat.MediaStyle().setShowActionsInCompactView(0, 1))
            .build();
    }

    private void wake() {
        try {
            if (wake == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Sakina:adhkar");
                wake.setReferenceCounted(false);
            }
            if (!wake.isHeld()) wake.acquire(2 * 60 * 60 * 1000L);
        } catch (Exception ignored) { }
    }

    private void requestFocus() {
        try {
            am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (Build.VERSION.SDK_INT >= 26) {
                focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                    .build();
                am.requestAudioFocus(focus);
            } else am.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
        } catch (Exception ignored) { }
    }

    private void stopPlayer() {
        if (mp != null) { try { mp.stop(); } catch (Exception ignored) { } try { mp.release(); } catch (Exception ignored) { } mp = null; }
    }

    private void finish() {
        h.removeCallbacksAndMessages(null);
        stopPlayer();
        stopForeground(true);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        running = false;
        h.removeCallbacksAndMessages(null);
        stopPlayer();
        try { if (am != null) { if (Build.VERSION.SDK_INT >= 26 && focus != null) am.abandonAudioFocusRequest(focus); else am.abandonAudioFocus(null); } } catch (Exception ignored) { }
        try { if (wake != null && wake.isHeld()) wake.release(); } catch (Exception ignored) { }
        super.onDestroy();
    }
}
