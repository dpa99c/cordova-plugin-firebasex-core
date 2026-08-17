/**
 * @file AppDelegate+FirebasexCore.m
 * @brief AppDelegate category that initialises Firebase and broadcasts lifecycle events.
 *
 * Uses Objective-C method swizzling to intercept @c application:didFinishLaunchingWithOptions:
 * so Firebase can be configured before any feature plugins initialise. Lifecycle events
 * (foreground, background, URL open) are broadcast as @c NSNotification instances
 * that other modular FirebaseX plugins observe.
 */

#import "AppDelegate+FirebasexCore.h"
#import "FirebasexCorePlugin.h"
#import "FirebasexCoreWrapper.h"
#import <objc/runtime.h>

@import UserNotifications;

/** NSUserDefaults key for the associated @c applicationInBackground property. */
#define kApplicationInBackgroundKey @"applicationInBackground"

/** Notification name: app entered foreground. */
NSString * const FirebasexAppDidBecomeActive = @"FirebasexAppDidBecomeActive";
/** Notification name: app entered background. */
NSString * const FirebasexAppDidEnterBackground = @"FirebasexAppDidEnterBackground";
/** Notification name: Firebase configured, app finished launching. */
NSString * const FirebasexAppDidFinishLaunching = @"FirebasexAppDidFinishLaunching";
/** Notification name: app handled an incoming URL. */
NSString * const FirebasexHandleOpenURL = @"FirebasexHandleOpenURL";

@implementation CDVAppDelegate (FirebasexCore)

/** Singleton reference to the current CDVAppDelegate instance. */
static CDVAppDelegate *instance;

/** Returns the cached CDVAppDelegate singleton. */
+ (CDVAppDelegate *)instance {
    return instance;
}

/**
 * Swizzles @c application:didFinishLaunchingWithOptions: with
 * @c application:firebasexCoreDidFinishLaunchingWithOptions: at class load time.
 *
 * This ensures Firebase is initialised before Cordova plugins' @c pluginInitialize is called.
 */
+ (void)load {
    Method original = class_getInstanceMethod(self, @selector(application:didFinishLaunchingWithOptions:));
    Method swizzled = class_getInstanceMethod(self, @selector(application:firebasexCoreDidFinishLaunchingWithOptions:));
    method_exchangeImplementations(original, swizzled);
}

/**
 * Setter for the associated @c applicationInBackground property.
 *
 * Uses Objective-C associated objects because categories cannot add instance variables.
 */
- (void)setApplicationInBackground:(NSNumber *)applicationInBackground {
    objc_setAssociatedObject(self, kApplicationInBackgroundKey, applicationInBackground, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

/**
 * Getter for the associated @c applicationInBackground property.
 */
- (NSNumber *)applicationInBackground {
    return objc_getAssociatedObject(self, kApplicationInBackgroundKey);
}

/**
 * Swizzled version of @c application:didFinishLaunchingWithOptions:.
 *
 * Performs the following in order:
 * 1. Calls the original (swizzled) implementation.
 * 2. In DEBUG builds, enables Firebase and Analytics debug mode.
 * 3. Configures Firebase using GoogleService-Info.plist if available,
 *    falling back to @c [FIRApp configure] otherwise.
 * 4. Sets @c applicationInBackground to @c YES.
 * 5. Posts @c FirebasexAppDidFinishLaunching so feature plugins can react.
 *
 * @param application    The UIApplication instance.
 * @param launchOptions  The launch options dictionary.
 * @return Always @c YES.
 */
- (BOOL)application:(UIApplication *)application firebasexCoreDidFinishLaunchingWithOptions:(NSDictionary *)launchOptions {
    // Call the original implementation (swizzled)
    [self application:application firebasexCoreDidFinishLaunchingWithOptions:launchOptions];

#if DEBUG
    [[NSUserDefaults standardUserDefaults] setBool:YES forKey:@"/google/firebase/debug_mode"];
    [[NSUserDefaults standardUserDefaults] setBool:YES forKey:@"/google/measurement/debug_mode"];
#endif

    @try {
        instance = self;

        // Configure Firebase via the class method: under the cordova-ios 8 scene
        // lifecycle, plugins are created after this method returns, so
        // FirebasexCorePlugin.sharedInstance is still nil here and an instance
        // call would be silently dropped, leaving Firebase unconfigured.
        [FirebasexCorePlugin configureFirebase];

        self.applicationInBackground = @(YES);

        // UIApplicationDelegate applicationDidBecomeActive:/applicationDidEnterBackground:
        // are not called under the scene-based lifecycle, so observe the equivalent
        // notifications, which UIKit posts under both lifecycles.
        [[NSNotificationCenter defaultCenter] addObserver:self
                                                 selector:@selector(firebasexCoreApplicationDidBecomeActive:)
                                                     name:UIApplicationDidBecomeActiveNotification
                                                   object:nil];
        [[NSNotificationCenter defaultCenter] addObserver:self
                                                 selector:@selector(firebasexCoreApplicationDidEnterBackground:)
                                                     name:UIApplicationDidEnterBackgroundNotification
                                                   object:nil];

        // Notify other plugins that Firebase has been initialized
        [[NSNotificationCenter defaultCenter] postNotificationName:FirebasexAppDidFinishLaunching object:nil userInfo:launchOptions];

    } @catch (NSException *exception) {
        if (FirebasexCorePlugin.sharedInstance != nil) {
            [FirebasexCorePlugin.sharedInstance handlePluginExceptionWithoutContext:exception];
        } else {
            NSLog(@"FirebasexCore[native] ERROR: EXCEPTION during launch: %@", exception.reason);
        }
    }

    return YES;
}

/**
 * Called when the app enters the foreground (@c UIApplicationDidBecomeActiveNotification).
 *
 * Driven by the notification rather than the @c UIApplicationDelegate callback because
 * the delegate callbacks are not invoked under the scene-based lifecycle (cordova-ios 8).
 *
 * Updates @c applicationInBackground to @c NO, executes the JS lifecycle callback,
 * and posts @c FirebasexAppDidBecomeActive.
 */
- (void)firebasexCoreApplicationDidBecomeActive:(NSNotification *)notification {
    self.applicationInBackground = @(NO);
    @try {
        [FirebasexCorePlugin.sharedInstance _logMessage:@"Enter foreground"];
        [FirebasexCorePlugin.sharedInstance executeGlobalJavascript:@"FirebasexCore._applicationDidBecomeActive()"];
        [[NSNotificationCenter defaultCenter] postNotificationName:FirebasexAppDidBecomeActive object:nil];
    } @catch (NSException *exception) {
        [FirebasexCorePlugin.sharedInstance handlePluginExceptionWithoutContext:exception];
    }
}

/**
 * Called when the app enters the background (@c UIApplicationDidEnterBackgroundNotification).
 *
 * Driven by the notification rather than the @c UIApplicationDelegate callback because
 * the delegate callbacks are not invoked under the scene-based lifecycle (cordova-ios 8).
 *
 * Updates @c applicationInBackground to @c YES, executes the JS lifecycle callback,
 * and posts @c FirebasexAppDidEnterBackground.
 */
- (void)firebasexCoreApplicationDidEnterBackground:(NSNotification *)notification {
    self.applicationInBackground = @(YES);
    @try {
        [FirebasexCorePlugin.sharedInstance _logMessage:@"Enter background"];
        [FirebasexCorePlugin.sharedInstance executeGlobalJavascript:@"FirebasexCore._applicationDidEnterBackground()"];
        [[NSNotificationCenter defaultCenter] postNotificationName:FirebasexAppDidEnterBackground object:nil];
    } @catch (NSException *exception) {
        [FirebasexCorePlugin.sharedInstance handlePluginExceptionWithoutContext:exception];
    }
}

/**
 * Called when the app handles an incoming URL.
 *
 * Posts @c FirebasexHandleOpenURL with the URL as the notification object,
 * allowing feature plugins (e.g., auth) to process deep links.
 */
- (void)handleOpenURL:(NSNotification *)notification {
    NSURL *url = [notification object];
    [[NSNotificationCenter defaultCenter] postNotificationName:FirebasexHandleOpenURL object:url];
}

@end
