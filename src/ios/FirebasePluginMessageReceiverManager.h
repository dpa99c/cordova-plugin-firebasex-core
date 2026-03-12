/**
 * @file FirebasePluginMessageReceiverManager.h
 * @brief Manages registered @c FirebasePluginMessageReceiver instances on iOS.
 *
 * Maintains a list of receivers and dispatches incoming notifications to each one.
 */

#import <Foundation/Foundation.h>
#import "FirebasePluginMessageReceiver.h"

/**
 * Singleton manager that dispatches notifications to all registered
 * @c FirebasePluginMessageReceiver instances.
 */
@interface FirebasePluginMessageReceiverManager : NSObject

/**
 * Registers a message receiver.
 *
 * Typically called automatically by @c FirebasePluginMessageReceiver's @c init.
 *
 * @param receiver The receiver to register.
 */
+ (void)registerMessageReceiver:(FirebasePluginMessageReceiver *)receiver;

/**
 * Dispatches a notification to all registered receivers.
 *
 * @param notification The notification payload dictionary.
 * @return @c YES if at least one receiver was registered and dispatched to; @c NO if no receivers are registered.
 */
+ (BOOL)sendNotification:(NSDictionary *)notification;

@end
