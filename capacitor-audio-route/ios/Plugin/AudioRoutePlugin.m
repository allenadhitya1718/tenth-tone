#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Registers the Swift class with Capacitor's Objective-C runtime lookup. The
// JS name must match the Android @CapacitorPlugin(name = "AudioRoute") so one
// call site in agora.js works on both platforms.
CAP_PLUGIN(AudioRoutePlugin, "AudioRoute",
           CAP_PLUGIN_METHOD(setSpeaker, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(reset, CAPPluginReturnPromise);
)
