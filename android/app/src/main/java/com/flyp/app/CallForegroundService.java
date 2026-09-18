package com.flyp.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

/**
 * Keeps a call alive while FLYP is not the app on screen, and puts it in the
 * notification shade the way a phone does.
 *
 * Why a service at all. The call is an Agora session living inside the
 * WebView. Leave the app and Android is free to freeze or kill that process
 * whenever it likes - the call simply stops, with no message and nothing to
 * tap. A foreground service is the documented way to say "this process is
 * doing something the person can see and asked for", and the notification is
 * not decoration: it is the price of staying alive, and the thing they use to
 * get back or hang up.
 *
 * The type is MICROPHONE rather than PHONE_CALL. Both are honest - a call
 * does hold the microphone - but from Android 14 the phoneCall type expects a
 * self-managed ConnectionService (CallKit's counterpart), which this app does
 * not have and which would refuse to start. Microphone is what we actually
 * hold, and it starts cleanly from the foreground, which is the only place we
 * start it from: the call screen is open when a call connects.
 *
 * Deliberately NOT NotificationCompat.CallStyle, which would look closer to
 * the screenshot. CallStyle needs androidx.core 1.9+, and this file cannot be
 * compiled on the machine it was written on - the first compile is CI. A
 * plain ongoing notification with a Hang up action resolves against any
 * androidx version, and can be upgraded once this is known to build.
 */
public class CallForegroundService extends Service {

    public static final String ACTION_START = "app.flyp.call.START";
    public static final String ACTION_STOP = "app.flyp.call.STOP";
    public static final String ACTION_HANGUP = "app.flyp.call.HANGUP";

    public static final String EXTRA_NAME = "name";
    public static final String EXTRA_TEXT = "text";

    private static final String CHANNEL_ID = "flyp_call";
    private static final int NOTIFICATION_ID = 4711;

    @Override
    public IBinder onBind(Intent intent) {
        return null;   // nothing binds to it; it is started and stopped
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        final String action = intent == null ? ACTION_START : String.valueOf(intent.getAction());

        if (ACTION_HANGUP.equals(action)) {
            // Tell the web layer, which owns the call, and let it wind the
            // session down properly - ending the row, leaving the channel,
            // releasing the microphone. Then this notification has no reason
            // to exist. If the page is gone the call is gone with it, so
            // stopping is right either way.
            CallNotificationPlugin.fireHangup();
            stopSelfSafely();
            return START_NOT_STICKY;
        }
        if (ACTION_STOP.equals(action)) {
            stopSelfSafely();
            return START_NOT_STICKY;
        }

        final String name = intent != null && intent.getStringExtra(EXTRA_NAME) != null
                ? intent.getStringExtra(EXTRA_NAME) : "";
        final String text = intent != null && intent.getStringExtra(EXTRA_TEXT) != null
                ? intent.getStringExtra(EXTRA_TEXT) : "";

        startInForeground(buildNotification(name, text));
        return START_STICKY;
    }

    private void startInForeground(Notification n) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            } else {
                startForeground(NOTIFICATION_ID, n);
            }
        } catch (Exception e) {
            // A refused foreground start must not take the call with it: the
            // call is running in the WebView and works without this, it is
            // only less protected. Better a call with no notification than a
            // crash mid-conversation.
            try { startForeground(NOTIFICATION_ID, n); } catch (Exception ignored) {}
        }
    }

    private void stopSelfSafely() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(Service.STOP_FOREGROUND_REMOVE);
            else stopForeground(true);
        } catch (Exception ignored) {}
        stopSelf();
    }

    private Notification buildNotification(String name, String text) {
        createChannel();

        // Tapping the notification returns to the app and its call screen.
        // singleTask on MainActivity means this resumes the existing instance
        // rather than building a second one on top of the running call.
        Intent open = new Intent(this, MainActivity.class);
        open.setAction(Intent.ACTION_MAIN);
        open.addCategory(Intent.CATEGORY_LAUNCHER);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPi = PendingIntent.getActivity(this, 0, open, piFlags());

        Intent hangup = new Intent(this, CallForegroundService.class).setAction(ACTION_HANGUP);
        PendingIntent hangupPi = PendingIntent.getService(this, 1, hangup, piFlags());

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.sym_call_outgoing)
                .setContentTitle(name.isEmpty() ? text : name)
                .setContentText(text)
                .setContentIntent(openPi)
                .setOngoing(true)                       // cannot be swiped away
                .setOnlyAlertOnce(true)
                .setShowWhen(true)
                .setUsesChronometer(true)               // counts the call up, as the shade does
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel,
                           getString(R.string.call_hang_up), hangupPi);
        return b.build();
    }

    private static int piFlags() {
        // Immutable is required from Android 12 and correct everywhere: the
        // system must not be able to rewrite what this intent does.
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                ? (PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE)
                : PendingIntent.FLAG_UPDATE_CURRENT;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        // Silent on purpose. The call is already audible; a chime when the
        // notification appears mid-conversation is noise in the ear.
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, getString(R.string.call_channel_name), NotificationManager.IMPORTANCE_LOW);
        ch.setDescription(getString(R.string.call_channel_desc));
        ch.setSound(null, null);
        ch.enableVibration(false);
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }
}
