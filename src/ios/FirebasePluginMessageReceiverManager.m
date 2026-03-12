/**
 * @file FirebasePluginMessageReceiverManager.m
 * @brief Implementation of the message receiver manager for iOS.
 *
 * Maintains a static list of registered @c FirebasePluginMessageReceiver instances
 * and dispatches notifications to each one when called by the messaging plugin.
 */

#import "FirebasePluginMessageReceiverManager.h"

@implementation FirebasePluginMessageReceiverManager

/** Lazily-initialised list of registered message receiver instances. */
static NSMutableArray<FirebasePluginMessageReceiver *> *receivers;

/**
 * Registers a message receiver, lazily creating the receivers array if needed.
 *
 * @param receiver The receiver to register.
 */
+ (void)registerMessageReceiver:(FirebasePluginMessageReceiver *)receiver {
    if (receivers == nil) {
        receivers = [[NSMutableArray alloc] init];
    }
    [receivers addObject:receiver];
}

/**
 * Dispatches a notification to all registered receivers.
 *
 * If no receivers are registered (array is @c nil), the call is a no-op.
 *
 * @param notification The notification payload dictionary.
 */
+ (BOOL)sendNotification:(NSDictionary *)notification {
    if (receivers == nil) return NO;
    for (FirebasePluginMessageReceiver *receiver in receivers) {
        [receiver sendNotification:notification];
    }
    return YES;
}

@end
