package app.sakina.duas;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

public class QuranPlaybackService extends Service {
    static final String ACTION_UPDATE = "app.sakina.duas.UPDATE";
    static final String ACTION_PAUSE = "app.sakina.duas.PAUSE";
    static final String ACTION_PLAY = "app.sakina.duas.PLAY";
    static final String ACTION_STOP = "app.sakina.duas.STOP";
    private static final String CHANNEL = "quran_playback";
    private static final int ID = 7114;

    static volatile boolean running = false;
    private PowerManager.WakeLock wake;
    private WifiManager.WifiLock wifi;

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_PAUSE.equals(action) || ACTION_PLAY.equals(action) || ACTION_STOP.equals(action)) {
            QuranPlaybackPlugin.sendAction(ACTION_PAUSE.equals(action) ? "pause" : ACTION_PLAY.equals(action) ? "play" : "stop");
            if (ACTION_STOP.equals(action)) { stopSelf(); return START_NOT_STICKY; }
            return START_NOT_STICKY;
        }
        String title = intent != null ? intent.getStringExtra("title") : "Quran";
        String text = intent != null ? intent.getStringExtra("text") : "";
        boolean playing = intent == null || intent.getBooleanExtra("playing", true);
        Notification n = build(title, text, playing);
        if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(ID, n);
        running = true;
        locks(playing);
        return START_NOT_STICKY;
    }

    private Notification build(String title, String text, boolean playing) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Quran recitation", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while the Quran is playing in the background");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        int pf = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(this, 0, open, pf);
        PendingIntent toggle = PendingIntent.getService(this, 1, new Intent(this, QuranPlaybackService.class).setAction(playing ? ACTION_PAUSE : ACTION_PLAY), pf);
        PendingIntent stop = PendingIntent.getService(this, 2, new Intent(this, QuranPlaybackService.class).setAction(ACTION_STOP), pf);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_sakina)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(content)
            .setOngoing(playing)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .addAction(0, playing ? "Pause" : "Play", toggle)
            .addAction(0, "Stop", stop)
            .setStyle(new androidx.media.app.NotificationCompat.MediaStyle().setShowActionsInCompactView(0, 1))
            .build();
    }

    private void locks(boolean on) {
        try {
            if (on) {
                if (wake == null) {
                    PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                    wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Sakina:quran");
                    wake.setReferenceCounted(false);
                }
                if (!wake.isHeld()) wake.acquire(6 * 60 * 60 * 1000L);
                if (wifi == null) {
                    WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                    wifi = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Sakina:quran");
                    wifi.setReferenceCounted(false);
                }
                if (!wifi.isHeld()) wifi.acquire();
            } else release();
        } catch (Exception ignored) { }
    }

    private void release() {
        try { if (wake != null && wake.isHeld()) wake.release(); } catch (Exception ignored) { }
        try { if (wifi != null && wifi.isHeld()) wifi.release(); } catch (Exception ignored) { }
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        QuranPlaybackPlugin.sendAction("stop");
        stopSelf();
    }

    @Override
    public void onDestroy() {
        running = false;
        release();
        stopForeground(true);
        super.onDestroy();
    }
}
