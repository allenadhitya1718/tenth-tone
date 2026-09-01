package com.flyp.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered before super.onCreate so the bridge sees it when the
        // WebView is created. Gives the call screen real earpiece/loudspeaker
        // routing, which the web layer cannot do at all.
        registerPlugin(AudioRoutePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
