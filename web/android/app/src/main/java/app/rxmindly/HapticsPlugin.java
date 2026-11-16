package app.rxmindly;

import android.content.Context;
import android.os.Build;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

/**
 * Plays the app's little vibrations (see web/src/lib/haptics.ts). Each one comes
 * in two forms: a composition of Android's crisp haptic "primitives" (clicks,
 * ticks, rises), used on phones that support them, and a plain waveform for the
 * rest. On Android 13+ they are played as touch feedback, so the phone's own
 * "vibration and haptics" settings still apply.
 */
@CapacitorPlugin(name = "RxHaptics")
public class HapticsPlugin extends Plugin {
    private Vibrator vibrator() {
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager = (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return manager == null ? null : manager.getDefaultVibrator();
        }
        return (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
    }

    @PluginMethod
    public void play(PluginCall call) {
        try {
            Vibrator vibrator = vibrator();
            if (vibrator == null || !vibrator.hasVibrator()) {
                call.resolve();
                return;
            }
            VibrationEffect effect = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) effect = composed(vibrator, call.getArray("steps"));
            if (effect == null) effect = waveform(vibrator, call.getArray("timings"), call.getArray("amplitudes"));
            if (effect == null) {
                call.resolve();
                return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                vibrator.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_TOUCH));
            } else {
                vibrator.vibrate(effect);
            }
            call.resolve();
        } catch (Exception e) {
            // A missed buzz is never worth an error on the web side.
            call.resolve();
        }
    }

    private static int primitive(String name) {
        switch (name) {
            case "click": return VibrationEffect.Composition.PRIMITIVE_CLICK;
            case "tick": return VibrationEffect.Composition.PRIMITIVE_TICK;
            case "lowTick": return VibrationEffect.Composition.PRIMITIVE_LOW_TICK;
            case "thud": return VibrationEffect.Composition.PRIMITIVE_THUD;
            case "spin": return VibrationEffect.Composition.PRIMITIVE_SPIN;
            case "quickRise": return VibrationEffect.Composition.PRIMITIVE_QUICK_RISE;
            case "slowRise": return VibrationEffect.Composition.PRIMITIVE_SLOW_RISE;
            case "quickFall": return VibrationEffect.Composition.PRIMITIVE_QUICK_FALL;
            default: return -1;
        }
    }

    /** Null when the phone can't play every primitive asked for, so the waveform is used instead. */
    private static VibrationEffect composed(Vibrator vibrator, JSArray steps) throws Exception {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || steps == null || steps.length() == 0) return null;
        int[] ids = new int[steps.length()];
        for (int i = 0; i < steps.length(); i++) {
            ids[i] = primitive(steps.getJSONObject(i).optString("p"));
            if (ids[i] < 0) return null;
        }
        if (!vibrator.areAllPrimitivesSupported(ids)) return null;
        VibrationEffect.Composition composition = VibrationEffect.startComposition();
        for (int i = 0; i < steps.length(); i++) {
            JSONObject step = steps.getJSONObject(i);
            float scale = (float) Math.max(0, Math.min(1, step.optDouble("s", 1)));
            composition.addPrimitive(ids[i], scale, Math.max(0, step.optInt("d", 0)));
        }
        return composition.compose();
    }

    private static VibrationEffect waveform(Vibrator vibrator, JSArray timingsJson, JSArray amplitudesJson) throws Exception {
        if (timingsJson == null || timingsJson.length() == 0) return null;
        int n = timingsJson.length();
        long[] timings = new long[n];
        int[] amplitudes = new int[n];
        for (int i = 0; i < n; i++) {
            timings[i] = Math.max(0, timingsJson.getLong(i));
            int amplitude = amplitudesJson != null && i < amplitudesJson.length() ? amplitudesJson.getInt(i) : (i % 2 == 1 ? 255 : 0);
            amplitudes[i] = Math.max(0, Math.min(255, amplitude));
        }
        if (!vibrator.hasAmplitudeControl()) {
            // On/off only: anything audible in the waveform becomes full strength.
            for (int i = 0; i < n; i++) if (amplitudes[i] > 0) amplitudes[i] = 255;
        }
        return VibrationEffect.createWaveform(timings, amplitudes, -1);
    }
}
