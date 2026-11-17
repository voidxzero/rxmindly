package app.rxmindly;

import android.app.Activity;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.view.Window;
import android.view.WindowManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Shared bits of the full-screen medicine alarms: what is scheduled, what is
 * ringing now, and the settings the web side hands over. Everything is kept in
 * SharedPreferences, so alarms survive a reboot and the ringing alarm is found
 * again when the app opens, even if the app wasn't running when it went off.
 *
 * An "item" is one medicine on an alarm: {id, date, time, name, detail}. An
 * alarm is {at (epoch ms), items: [...]}.
 */
final class AlarmCore {
    static final String ACTION_FIRE = "app.rxmindly.alarm.FIRE";
    private static final String PREFS = "rxmindly_alarms";
    private static final String SCHEDULED = "scheduled";
    private static final String ACTIVE = "active";

    private AlarmCore() {}

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ----- Settings from the web side -----

    static void saveConfig(Context context, boolean sound, boolean vibrate, int silenceMinutes) {
        prefs(context).edit().putBoolean("sound", sound).putBoolean("vibrate", vibrate).putInt("silence", Math.max(1, silenceMinutes)).apply();
    }

    static boolean sound(Context context) { return prefs(context).getBoolean("sound", true); }
    static boolean vibrate(Context context) { return prefs(context).getBoolean("vibrate", true); }
    static int silenceMinutes(Context context) { return prefs(context).getInt("silence", 5); }

    // ----- Scheduling -----

    private static PendingIntent firePending(Context context, long at, String payload) {
        Intent intent = new Intent(context, AlarmReceiver.class).setAction(ACTION_FIRE);
        if (payload != null) intent.putExtra("payload", payload);
        return PendingIntent.getBroadcast(context, (int) (at / 1000), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static PendingIntent openApp(Context context, int requestCode) {
        Intent intent = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void set(Context context, JSONObject alarm) throws JSONException {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        long at = alarm.getLong("at");
        // An alarm-clock alarm: exact, allowed through Doze, and shown as the alarm icon in the status bar.
        manager.setAlarmClock(new AlarmManager.AlarmClockInfo(at, openApp(context, 1)), firePending(context, at, alarm.toString()));
    }

    /** Replaces every scheduled alarm with `alarms` (an array of {at, items}). */
    static void schedule(Context context, JSONArray alarms) throws JSONException {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        JSONArray old = new JSONArray(prefs(context).getString(SCHEDULED, "[]"));
        for (int i = 0; i < old.length(); i++) manager.cancel(firePending(context, old.getJSONObject(i).getLong("at"), null));
        long now = System.currentTimeMillis();
        JSONArray kept = new JSONArray();
        for (int i = 0; i < alarms.length(); i++) {
            JSONObject alarm = alarms.getJSONObject(i);
            if (alarm.getLong("at") <= now) continue;
            try {
                set(context, alarm);
                kept.put(alarm);
            } catch (SecurityException e) {
                // Not allowed to set exact alarms: nothing more can be done here.
            }
        }
        prefs(context).edit().putString(SCHEDULED, kept.toString()).apply();
    }

    /** After a reboot or an app update, which clear alarms. */
    static void reschedulePersisted(Context context) {
        try {
            schedule(context, new JSONArray(prefs(context).getString(SCHEDULED, "[]")));
        } catch (JSONException e) {
            // Nothing sensible to restore.
        }
    }

    /** A one-off alarm that isn't part of the schedule (the test in Settings). */
    static void setOneOff(Context context, JSONObject alarm) throws JSONException {
        set(context, alarm);
    }

    // ----- The alarm that is ringing, or waiting to be answered -----

    static JSONArray active(Context context) {
        try {
            return new JSONArray(prefs(context).getString(ACTIVE, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    static boolean hasActive(Context context) {
        return active(context).length() > 0;
    }

    /** Adds medicines to the alarm on screen (an alarm that goes off while another is unanswered joins it). */
    static void mergeActive(Context context, JSONArray items) throws JSONException {
        JSONArray now = active(context);
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.getJSONObject(i);
            boolean have = false;
            for (int j = 0; j < now.length() && !have; j++) have = item.optString("id").equals(now.getJSONObject(j).optString("id"));
            if (!have) now.put(item);
        }
        prefs(context).edit().putString(ACTIVE, now.toString()).apply();
    }

    static void clearActive(Context context) {
        prefs(context).edit().remove(ACTIVE).putBoolean("ringing", false).apply();
    }

    static boolean ringing(Context context) { return prefs(context).getBoolean("ringing", false); }
    static void setRinging(Context context, boolean on) { prefs(context).edit().putBoolean("ringing", on).apply(); }

    // ----- The screen -----

    /** Lets the app show over the lock screen and turns the screen on while an alarm is waiting; undoes it afterwards. */
    static void applyFlags(Activity activity) {
        boolean on = hasActive(activity);
        Window window = activity.getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            activity.setShowWhenLocked(on);
            activity.setTurnScreenOn(on);
        } else if (on) {
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
