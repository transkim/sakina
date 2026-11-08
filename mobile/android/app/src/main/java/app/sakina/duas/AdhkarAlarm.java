package app.sakina.duas;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import java.util.Calendar;
import org.json.JSONArray;
import org.json.JSONObject;

/** Fires at the morning / evening time, starts the player, and sets tomorrow's alarm. Re-arms after a reboot. */
public class AdhkarAlarm extends BroadcastReceiver {
    static final String ACTION_FIRE = "app.sakina.duas.ADHKAR_FIRE";
    private static final String PREFS = "sakina_adhkar";

    static void save(Context c, String slotsJson) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("slots", slotsJson).apply();
    }

    static JSONArray slots(Context c) {
        try { return new JSONArray(c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("slots", "[]")); }
        catch (Exception e) { return new JSONArray(); }
    }

    static JSONObject slot(Context c, String key) {
        JSONArray a = slots(c);
        for (int i = 0; i < a.length(); i++) {
            JSONObject s = a.optJSONObject(i);
            if (s != null && key.equals(s.optString("key"))) return s;
        }
        return null;
    }

    static boolean canExact(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        return Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
    }

    private static PendingIntent pi(Context c, String key) {
        Intent i = new Intent(c, AdhkarAlarm.class).setAction(ACTION_FIRE).putExtra("key", key);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getBroadcast(c, "evening".equals(key) ? 31 : 30, i, flags);
    }

    static void armAll(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        for (String key : new String[] { "morning", "evening" }) {
            am.cancel(pi(c, key));
            JSONObject s = slot(c, key);
            if (s == null || !s.optBoolean("on")) continue;
            Calendar t = Calendar.getInstance();
            t.set(Calendar.HOUR_OF_DAY, s.optInt("hour"));
            t.set(Calendar.MINUTE, s.optInt("minute"));
            t.set(Calendar.SECOND, 0);
            t.set(Calendar.MILLISECOND, 0);
            if (t.getTimeInMillis() <= System.currentTimeMillis() + 1000) t.add(Calendar.DAY_OF_YEAR, 1);
            long at = t.getTimeInMillis();
            try {
                if (canExact(c) && Build.VERSION.SDK_INT >= 23) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi(c, key));
                else if (Build.VERSION.SDK_INT >= 23) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi(c, key));
                else am.setExact(AlarmManager.RTC_WAKEUP, at, pi(c, key));
            } catch (SecurityException e) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi(c, key));
            }
        }
    }

    static void startSlot(Context c, String key) {
        Intent i = new Intent(c, AdhkarService.class).setAction(AdhkarService.ACTION_START).putExtra("key", key);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
        else c.startService(i);
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        String action = intent.getAction();
        if (ACTION_FIRE.equals(action)) {
            String key = intent.getStringExtra("key");
            try { if (key != null) startSlot(c, key); } catch (Exception ignored) { }
        }
        // after firing, a reboot, an app update or a clock change: set the next alarms
        armAll(c);
    }
}
