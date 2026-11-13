package app.rxmindly;

import android.content.Context;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The app's data lives in the web view, which a home screen widget can't read.
 * The web side calls this with a small summary of the doses still to take
 * (see web/src/lib/widget.ts); it is stored where the widget can find it.
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {
    @PluginMethod
    public void update(PluginCall call) {
        Context context = getContext();
        context.getSharedPreferences(NextDoseWidget.PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(NextDoseWidget.KEY, call.getString("data", ""))
                .apply();
        NextDoseWidget.refreshAll(context);
        call.resolve();
    }
}
