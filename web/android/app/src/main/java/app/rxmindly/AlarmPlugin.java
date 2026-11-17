package app.rxmindly;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.lang.ref.WeakReference;

/**
 * How the web side reaches the full-screen medicine alarms (see
 * web/src/lib/alarm-native.ts). It sets the alarms, stops the sound, reports
 * what is on screen, and tells the web side whenever that changes.
 */
@CapacitorPlugin(name = "RxAlarm")
public class AlarmPlugin extends Plugin {
    private static WeakReference<AlarmPlugin> instance = new WeakReference<>(null);

    @Override
    public void load() {
        instance = new WeakReference<>(this);
    }

    private static JSObject state(Context context) {
        JSObject out = new JSObject();
        out.put("items", AlarmCore.active(context));
        out.put("ringing", AlarmCore.ringing(context));
        return out;
    }

    /** Lets the web side know the alarm on screen changed (called from the service, in any process state). */
    static void emit(Context context) {
        AlarmPlugin plugin = instance.get();
        if (plugin == null) return;
        plugin.notifyListeners("alarm", state(context));
        if (plugin.getActivity() != null) plugin.getActivity().runOnUiThread(() -> AlarmCore.applyFlags(plugin.getActivity()));
    }

    /** Replaces every scheduled alarm. Takes {alarms: [{at, items}], sound, vibrate, silenceMinutes}. */
    @PluginMethod
    public void schedule(PluginCall call) {
        try {
            AlarmCore.saveConfig(getContext(), call.getBoolean("sound", true), call.getBoolean("vibrate", true), call.getInt("silenceMinutes", 5));
            JSArray alarms = call.getArray("alarms");
            AlarmCore.schedule(getContext(), alarms == null ? new JSONArray() : alarms);
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't set the alarms: " + e.getMessage());
        }
    }

    /** One alarm that isn't part of the schedule, `delaySeconds` from now (the test in Settings). */
    @PluginMethod
    public void test(PluginCall call) {
        try {
            JSONObject alarm = new JSONObject();
            alarm.put("at", System.currentTimeMillis() + call.getInt("delaySeconds", 10) * 1000L);
            alarm.put("items", call.getArray("items"));
            AlarmCore.setOneOff(getContext(), alarm);
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't set the test alarm: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getActive(PluginCall call) {
        call.resolve(state(getContext()));
    }

    /** Stops the sound and vibration; the notification and the full-screen view stay. */
    @PluginMethod
    public void stopSound(PluginCall call) {
        getContext().startService(new Intent(getContext(), AlarmService.class).setAction(AlarmService.ACTION_STOP_SOUND));
        call.resolve();
    }

    /** Every medicine is answered: stop everything and clear the alarm. */
    @PluginMethod
    public void dismiss(PluginCall call) {
        AlarmCore.clearActive(getContext());
        getContext().startService(new Intent(getContext(), AlarmService.class).setAction(AlarmService.ACTION_DISMISS));
        if (getActivity() != null) getActivity().runOnUiThread(() -> AlarmCore.applyFlags(getActivity()));
        call.resolve();
    }

    /** Whether Android lets alarms take over the screen. It can be switched off per app on Android 14+. */
    @PluginMethod
    public void status(PluginCall call) {
        NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        boolean fullScreen = Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE || manager.canUseFullScreenIntent();
        JSObject out = new JSObject();
        out.put("fullScreen", fullScreen);
        call.resolve(out);
    }

    @PluginMethod
    public void openFullScreenSettings(PluginCall call) {
        Intent intent = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
            ? new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getContext().getPackageName()))
            : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }
}
