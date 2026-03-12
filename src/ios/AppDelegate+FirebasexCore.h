/**
 * @file AppDelegate+FirebasexCore.h
 * @brief AppDelegate category for Firebase initialisation and lifecycle events.
 *
 * Swizzles @c application:didFinishLaunchingWithOptions: to initialise Firebase
 * and broadcasts @c NSNotification events so feature plugins can react to
 * app lifecycle transitions without coupling to the core plugin.
 */

#import "AppDelegate.h"
@import UserNotifications;

/** Posted when the app enters the foreground (@c applicationDidBecomeActive:). */
extern NSString * _Nonnull const FirebasexAppDidBecomeActive;
/** Posted when the app enters the background (@c applicationDidEnterBackground:). */
extern NSString * _Nonnull const FirebasexAppDidEnterBackground;
/** Posted after Firebase has been configured in @c didFinishLaunchingWithOptions:. */
extern NSString * _Nonnull const FirebasexAppDidFinishLaunching;
/** Posted when the app handles an incoming URL (@c handleOpenURL:). */
extern NSString * _Nonnull const FirebasexHandleOpenURL;

/**
 * Category on @c AppDelegate that handles Firebase initialisation and
 * lifecycle notifications for the modular FirebaseX plugin suite.
 */
@interface AppDelegate (FirebasexCore) <UIApplicationDelegate>

/** Returns the current @c AppDelegate singleton instance. */
+ (AppDelegate * _Nonnull)instance;

/** @c YES when the application is in the background; @c NO when in the foreground. */
@property (nonatomic, strong) NSNumber * _Nonnull applicationInBackground;

@end
