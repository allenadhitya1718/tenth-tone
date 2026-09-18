#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Registers the Swift class with Capacitor's Objective-C runtime lookup, the
// same way AudioRoutePlugin.m does. The JS name is "AgoraCall"; there is no
// Android counterpart on purpose - Android's route switching has never been
// broken, so it stays on the web SDK.
//
// addListener / removeAllListeners are NOT declared here: the bridge provides
// them for every plugin, so the remoteChanged and callError events this
// plugin emits are subscribable without them.
CAP_PLUGIN(AgoraCallPlugin, "AgoraCall",
           CAP_PLUGIN_METHOD(isAvailable, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(join, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(leave, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(setMuted, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(setSpeaker, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(stats, CAPPluginReturnPromise);
)
