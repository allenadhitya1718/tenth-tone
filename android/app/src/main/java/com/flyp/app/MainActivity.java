package com.flyp.app;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered before super.onCreate so the bridge sees it when the
        // WebView is created. Gives the call screen real earpiece/loudspeaker
        // routing, which the web layer cannot do at all.
        registerPlugin(AudioRoutePlugin.class);
        // Saving a chat photo or video to the gallery. An <a download> is
        // inert in a WebView and the share sheet only offers other apps, so
        // without this the Save button did nothing a person could find.
        registerPlugin(MediaSavePlugin.class);
        // Keeps a call alive - and visible, with a Hang up button - while the
        // person is in another app. Android may freeze or kill this process
        // the moment FLYP leaves the screen; a foreground service is the only
        // way to say the call is still worth keeping.
        registerPlugin(CallNotificationPlugin.class);
        super.onCreate(savedInstanceState);

        // ── Keep the page clear of the navigation bar ──
        // From targetSdk 35, Android 15 and later draw every app edge to edge:
        // the window runs under the status bar AND the navigation bar, and at
        // targetSdk 36 an app can no longer opt out. The status bar was already
        // like that on purpose (StatusBar overlaysWebView, with the page padding
        // itself through env(safe-area-inset-top)), but the tab bar and the chat
        // composer would now sit under the Back and Home buttons, where a tap
        // goes to the system instead of the app.
        //
        // So the content view is padded clear of the navigation bar (and of a
        // side cutout in landscape), and the same amounts are taken off the
        // insets the WebView receives - otherwise a WebView that reports system
        // bars through env(safe-area-inset-bottom) would pad the page a second
        // time. The top is left alone, so the page lays out exactly as it did at
        // targetSdk 34. On Android 14 and older the system still keeps the
        // window above the navigation bar, the insets arrive here as zero, and
        // this changes nothing. The strip under the buttons shows this view's
        // background: black, like the bar it replaces.
        //
        // The keyboard stays the Keyboard plugin's job (resizeOnFullScreen sizes
        // the content's child to the top of the keyboard from the visible frame,
        // not from these insets), so the two do not interact.
        final View content = findViewById(android.R.id.content);
        content.setBackgroundColor(Color.BLACK);
        ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
            Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.navigationBars() | WindowInsetsCompat.Type.displayCutout()
            );
            v.setPadding(bars.left, 0, bars.right, bars.bottom);
            return insets.inset(bars.left, 0, bars.right, bars.bottom);
        });

        // ── The back button ──
        // Asked of the page and settled here. The page (app.js,
        // window.__ttBack) knows which screens are roots: from one of those
        // it answers 'exit'; anywhere else it steps its own history back and
        // answers 'handled'.
        //
        // Registered AFTER super.onCreate - after the App plugin has added its
        // own callback - so this is the one Android consults. 1.4.11 left the
        // decision to that plugin's backButton event, and a phone on 1.4.12
        // still walked the WebView's history from the feed to the login screen
        // (18 Sep). Now the decision does not depend on a JavaScript listener
        // reaching the plugin at all.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                final WebView web = MainActivity.this.getBridge() == null ? null : MainActivity.this.getBridge().getWebView();
                if (web == null) { MainActivity.this.finish(); return; }
                web.evaluateJavascript(
                    "(function(){try{return window.__ttBack?String(window.__ttBack('native')):'none'}catch(e){return 'none'}})()",
                    value -> {
                        if ("\"exit\"".equals(value)) {
                            MainActivity.this.finish();
                        } else if (!"\"handled\"".equals(value)) {
                            // No page to ask (still loading, or an older
                            // build): the WebView's own history, then out.
                            if (web.canGoBack()) web.goBack(); else MainActivity.this.finish();
                        }
                    }
                );
            }
        });
    }
}
