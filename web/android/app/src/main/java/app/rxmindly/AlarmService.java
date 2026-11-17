package app.rxmindly;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;

/**
 * Rings a medicine alarm: the alarm sound and a repeating vibration, plus an
 * ongoing notification whose full-screen intent opens the app over the lock
 * screen. Stopping the sound leaves the notification (and the screen) until
 * every medicine has been answered; the web side then asks for DISMISS.
 */
public class AlarmService extends Service {
    static final String ACTION_RING = "app.rxmindly.alarm.RING";
    static final String ACTION_STOP_SOUND = "app.rxmindly.alarm.STOP_SOUND";
    static final String ACTION_DISMISS = "app.rxmindly.alarm.DISMISS";
    private static final String CHANNEL = "alarms";
    private static final int NOTIFICATION_ID = 7001;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private MediaPlayer player;
    private PowerManager.WakeLock wakeLock;
    private final Runnable silencer = this::quiet;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (AlarmService.ACTION_RING.equals(action)) {
            ring();
        } else if (AlarmService.ACTION_DISMISS.equals(action)) {
            stopSound();
            AlarmCore.clearActive(this);
            stopForeground(STOP_FOREGROUND_REMOVE);
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel(NOTIFICATION_ID);
            AlarmPlugin.emit(this);
            stopSelf();
        } else {
            // STOP_SOUND, or a restart with nothing to ring.
            quiet();
        }
        return START_NOT_STICKY;
    }

    private void ring() {
        createChannel();
        Notification notification = notification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        stopSound();
        AlarmCore.setRinging(this, true);
        PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "rxmindly:alarm");
        long silenceMs = AlarmCore.silenceMinutes(this) * 60_000L;
        wakeLock.acquire(silenceMs + 30_000L);
        if (AlarmCore.sound(this)) startSound();
        if (AlarmCore.vibrate(this)) startVibration();
        handler.removeCallbacks(silencer);
        handler.postDelayed(silencer, silenceMs);
        AlarmPlugin.emit(this);
    }

    /** Sound and vibration off; the notification and the full-screen view stay. */
    private void quiet() {
        stopSound();
        AlarmCore.setRinging(this, false);
        stopForeground(STOP_FOREGROUND_DETACH);
        AlarmPlugin.emit(this);
        stopSelf();
    }

    private void startSound() {
        try {
            Uri uri = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM);
            if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            player.setDataSource(this, uri);
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch (Exception e) {
            // No sound is better than no alarm screen.
            releasePlayer();
        }
    }

    private void releasePlayer() {
        if (player == null) return;
        try {
            player.stop();
        } catch (IllegalStateException ignored) {
            // Never started.
        }
        player.release();
        player = null;
    }

    private Vibrator vibrator() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return manager == null ? null : manager.getDefaultVibrator();
        }
        return (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
    }

    @SuppressWarnings("deprecation")
    private void startVibration() {
        Vibrator vibrator = vibrator();
        if (vibrator == null || !vibrator.hasVibrator()) return;
        VibrationEffect effect = VibrationEffect.createWaveform(new long[] {0, 700, 500, 700, 1300}, 0);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            vibrator.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM));
        } else {
            vibrator.vibrate(effect, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
        }
    }

    private void stopSound() {
        handler.removeCallbacks(silencer);
        releasePlayer();
        Vibrator vibrator = vibrator();
        if (vibrator != null) vibrator.cancel();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    }

    private void createChannel() {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        // The sound and vibration are played here, not by the notification, so the channel stays quiet.
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Medicine alarms", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Full-screen alarms for medicine that is due");
        channel.setSound(null, null);
        channel.enableVibration(false);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(channel);
    }

    private Notification notification() {
        JSONArray items = AlarmCore.active(this);
        StringBuilder names = new StringBuilder();
        for (int i = 0; i < items.length(); i++) {
            if (i > 0) names.append(", ");
            names.append(items.optJSONObject(i).optString("name"));
        }
        PendingIntent open = AlarmCore.openApp(this, 2);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("Time to take your medicine")
            .setContentText(names.toString())
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(open)
            .setFullScreenIntent(open, true)
            .build();
    }

    @Override
    public void onDestroy() {
        stopSound();
        super.onDestroy();
    }
}
