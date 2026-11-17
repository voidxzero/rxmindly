package app.rxmindly;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.core.content.ContextCompat;

import org.json.JSONObject;

/** Wakes up when an alarm is due (or the phone restarted) and hands over to AlarmService. */
public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (AlarmCore.ACTION_FIRE.equals(action)) {
            try {
                JSONObject alarm = new JSONObject(intent.getStringExtra("payload"));
                AlarmCore.mergeActive(context, alarm.getJSONArray("items"));
                ContextCompat.startForegroundService(context, new Intent(context, AlarmService.class).setAction(AlarmService.ACTION_RING));
            } catch (Exception e) {
                // A malformed alarm can't ring; nothing to do.
            }
        } else if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            AlarmCore.reschedulePersisted(context);
        }
    }
}
