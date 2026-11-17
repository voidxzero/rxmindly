package app.rxmindly;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Lets the web side hand the home screen widget its data.
        registerPlugin(WidgetBridgePlugin.class);
        registerPlugin(UpdaterPlugin.class);
        registerPlugin(FileSaverPlugin.class);
        registerPlugin(HapticsPlugin.class);
        registerPlugin(AlarmPlugin.class);
        super.onCreate(savedInstanceState);
        AlarmCore.applyFlags(this);
    }

    // A medicine alarm opens the app over the lock screen; the flags last while one is waiting to be answered.
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        AlarmCore.applyFlags(this);
    }

    @Override
    public void onResume() {
        super.onResume();
        AlarmCore.applyFlags(this);
    }
}
