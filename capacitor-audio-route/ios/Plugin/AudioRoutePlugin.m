#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Registers the Swift class with Capacitor's Objective-C runtime lookup. The
// JS name must match the Android @CapacitorPlugin(name = "AudioRoute") so one
// call site in agora.js works on both platforms.
//
// addListener / removeAllListeners are NOT declared here on purpose: the
// Capacitor bridge handles those itself for every plugin, so the
// `audioRouteChanged` event this plugin emits is subscribable without them.
CAP_PLUGIN(AudioRoutePlugin, "AudioRoute",
           CAP_PLUGIN_METHOD(setSpeaker, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(setRoute, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(getRoute, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(reset, CAPPluginReturnPromise);
)
