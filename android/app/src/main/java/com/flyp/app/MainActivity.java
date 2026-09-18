package com.flyp.app;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

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
        super.onCreate(savedInstanceState);

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
