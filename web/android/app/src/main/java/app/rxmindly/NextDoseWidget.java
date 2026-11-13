package app.rxmindly;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.text.format.DateFormat;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

/**
 * Home screen widget: what is overdue, or when the next dose is.
 *
 * It works from the list of doses still to take that the app last saved
 * (two weeks ahead), so it stays right without the app running. It redraws
 * itself when the next dose comes due and at midnight.
 */
public class NextDoseWidget extends AppWidgetProvider {
    static final String PREFS = "widget";
    static final String KEY = "data";
    private static final String ACTION_REFRESH = "app.rxmindly.WIDGET_REFRESH";
    private static final long DAY = 24L * 60 * 60 * 1000;
    private static final long STALE_AFTER = 13 * DAY;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        refreshAll(context);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (ACTION_REFRESH.equals(intent.getAction())) refreshAll(context);
    }

    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, NextDoseWidget.class));
        if (ids.length == 0) return;
        long wakeAt;
        try {
            wakeAt = draw(context, manager, ids);
        } catch (Exception e) {
            // Unreadable data must never leave a broken widget on the home screen.
            RemoteViews views = base(context);
            show(context, views, context.getString(R.string.app_name), context.getString(R.string.widget_open), "", false);
            manager.updateAppWidget(ids, views);
            wakeAt = nextMidnight();
        }
        scheduleRefresh(context, wakeAt);
    }

    /** Draws every widget and returns when it next needs redrawing. */
    private static long draw(Context context, AppWidgetManager manager, int[] ids) throws Exception {
        String saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "");
        RemoteViews views = base(context);
        long now = System.currentTimeMillis();
        long wakeAt = nextMidnight();

        JSONObject data = saved == null || saved.isEmpty() ? null : new JSONObject(saved);
        if (data == null || !data.optBoolean("signedIn", false) || now - data.optLong("generatedAt", 0) > STALE_AFTER) {
            show(context, views, context.getString(R.string.app_name), context.getString(R.string.widget_open), context.getString(R.string.widget_open_sub), false);
            manager.updateAppWidget(ids, views);
            return wakeAt;
        }

        long startOfToday = startOfToday();
        JSONArray slots = data.optJSONArray("slots");
        int overdueCount = 0;
        long overdueSince = 0;
        StringBuilder overdueNames = new StringBuilder();
        JSONObject next = null;
        for (int i = 0; slots != null && i < slots.length(); i++) {
            JSONObject slot = slots.getJSONObject(i);
            long at = slot.getLong("at");
            if (at < startOfToday) continue; // an earlier day: missed, no longer the widget's business
            if (at <= now) {
                if (overdueCount == 0) overdueSince = at;
                overdueCount += slot.optInt("count", 1);
                if (overdueNames.length() > 0) overdueNames.append(", ");
                overdueNames.append(slot.optString("names"));
            } else if (next == null) {
                next = slot;
            }
        }
        if (next != null) wakeAt = Math.min(wakeAt, next.getLong("at"));

        String nextText = next == null ? "" : context.getString(R.string.widget_next_at, when(context, next.getLong("at"), now));
        if (overdueCount > 0) {
            show(context, views, context.getString(R.string.widget_overdue, time(context, overdueSince)), overdueNames.toString(), nextText, true);
        } else if (next != null) {
            show(context, views, context.getString(R.string.widget_next), when(context, next.getLong("at"), now), next.optString("names"), false);
        } else {
            show(context, views, context.getString(R.string.app_name), context.getString(R.string.widget_nothing), "", false);
        }
        manager.updateAppWidget(ids, views);
        return wakeAt;
    }

    private static RemoteViews base(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_next_dose);
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        views.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        return views;
    }

    private static void show(Context context, RemoteViews views, String label, String main, String sub, boolean warn) {
        views.setTextViewText(R.id.widget_label, label);
        views.setTextViewText(R.id.widget_main, main);
        views.setTextViewText(R.id.widget_sub, sub);
        views.setTextColor(R.id.widget_label, context.getColor(warn ? R.color.widget_warn : R.color.widget_accent));
        views.setViewVisibility(R.id.widget_sub, sub.isEmpty() ? android.view.View.GONE : android.view.View.VISIBLE);
    }

    private static String time(Context context, long at) {
        return DateFormat.getTimeFormat(context).format(new Date(at));
    }

    /** "8:00 PM" today, "Tomorrow 8:00 AM", otherwise "Sat 8:00 AM". */
    private static String when(Context context, long at, long now) {
        // Rounded, because a day with a clock change is 23 or 25 hours long.
        long days = Math.round((startOf(at) - startOf(now)) / (double) DAY);
        String time = time(context, at);
        if (days <= 0) return time;
        if (days == 1) return context.getString(R.string.widget_tomorrow, time);
        return new SimpleDateFormat("EEE", Locale.getDefault()).format(new Date(at)) + " " + time;
    }

    private static long startOf(long instant) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(instant);
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    private static long startOfToday() {
        return startOf(System.currentTimeMillis());
    }

    private static long nextMidnight() {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(startOfToday());
        c.add(Calendar.DAY_OF_YEAR, 1);
        return c.getTimeInMillis() + 1000;
    }

    private static void scheduleRefresh(Context context, long at) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        Intent intent = new Intent(context, NextDoseWidget.class).setAction(ACTION_REFRESH);
        PendingIntent pending = PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        // RTC, not RTC_WAKEUP: there is no point waking the phone to redraw a widget nobody is looking at.
        try {
            alarms.setExact(AlarmManager.RTC, at, pending);
        } catch (SecurityException e) {
            alarms.set(AlarmManager.RTC, at, pending);
        }
    }
}
