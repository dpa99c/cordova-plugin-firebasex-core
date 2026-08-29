/**
 * @file AppDelegate+FirebasexCore.m
 * @brief AppDelegate category that initialises Firebase and broadcasts lifecycle events.
 *
 * Uses Objective-C method swizzling to intercept @c application:didFinishLaunchingWithOptions:
 * so Firebase can be configured before any feature plugins initialise. Lifecycle events
 * (foreground, background, URL open) are broadcast as @c NSNotification instances
 * that other modular FirebaseX plugins observe. The lifecycle source is selected at
 * runtime for scene-based and legacy applications.
 */

#import "AppDelegate+FirebasexCore.h"
#import "FirebasexCorePlugin.h"
#import "FirebasexCoreWrapper.h"
#import <objc/runtime.h>

@import UIKit;
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

/** Returns whether the application uses the UIScene lifecycle. */
- (BOOL)firebasexCoreUsesSceneLifecycle {
    if (@available(iOS 13.0, *)) {
        id sceneManifest = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"UIApplicationSceneManifest"];
        return [sceneManifest isKindOfClass:NSDictionary.class];
    }
    return NO;
}

/** Returns whether at least one scene is currently active. */
- (BOOL)firebasexCoreHasActiveScene {
    if (@available(iOS 13.0, *)) {
        for (UIScene *scene in [UIApplication sharedApplication].connectedScenes) {
            if (scene.activationState == UISceneActivationStateForegroundActive) {
                return YES;
            }
        }
    }
    return NO;
}

/** Updates lifecycle state and broadcasts only actual state transitions. */
- (void)firebasexCoreSetApplicationInBackground:(BOOL)applicationInBackground {
    NSNumber *newValue = @(applicationInBackground);
    if ([self.applicationInBackground isEqualToNumber:newValue]) {
        return;
    }

    self.applicationInBackground = newValue;
    @try {
        FirebasexCorePlugin *corePlugin = [FirebasexCorePlugin sharedInstance];
        NSString *lifecycleMessage = applicationInBackground ? @"Enter background" : @"Enter foreground";
        NSString *javascriptCallback = applicationInBackground
            ? @"FirebasexCore._applicationDidEnterBackground()"
            : @"FirebasexCore._applicationDidBecomeActive()";
        NSString *notificationName = applicationInBackground
            ? FirebasexAppDidEnterBackground
            : FirebasexAppDidBecomeActive;

        [corePlugin _logMessage:lifecycleMessage];
        [corePlugin executeGlobalJavascript:javascriptCallback];
        [[NSNotificationCenter defaultCenter] postNotificationName:notificationName object:nil];
    } @catch (NSException *exception) {
        [[FirebasexCorePlugin sharedInstance] handlePluginExceptionWithoutContext:exception];
    }
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

        NSNotificationCenter *notificationCenter = [NSNotificationCenter defaultCenter];
        if ([self firebasexCoreUsesSceneLifecycle]) {
            [notificationCenter addObserver:self
                                   selector:@selector(firebasexCoreSceneDidBecomeActive:)
                                       name:UISceneDidActivateNotification
                                     object:nil];
            [notificationCenter addObserver:self
                                   selector:@selector(firebasexCoreSceneDidEnterBackground:)
                                       name:UISceneDidEnterBackgroundNotification
                                     object:nil];
        } else {
            [notificationCenter addObserver:self
                                   selector:@selector(firebasexCoreApplicationDidBecomeActive:)
                                       name:UIApplicationDidBecomeActiveNotification
                                     object:nil];
            [notificationCenter addObserver:self
                                   selector:@selector(firebasexCoreApplicationDidEnterBackground:)
                                       name:UIApplicationDidEnterBackgroundNotification
                                     object:nil];
        }

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
 * Called when a legacy application enters the foreground
 * (@c UIApplicationDidBecomeActiveNotification).
 *
 * Driven by the notification rather than the @c UIApplicationDelegate callback.
 *
 * Updates @c applicationInBackground to @c NO, executes the JS lifecycle callback,
 * and posts @c FirebasexAppDidBecomeActive.
 */
- (void)firebasexCoreApplicationDidBecomeActive:(NSNotification *)notification {
    [self firebasexCoreSetApplicationInBackground:NO];
}

/**
 * Called when a legacy application enters the background
 * (@c UIApplicationDidEnterBackgroundNotification).
 *
 * Driven by the notification rather than the @c UIApplicationDelegate callback.
 *
 * Updates @c applicationInBackground to @c YES, executes the JS lifecycle callback,
 * and posts @c FirebasexAppDidEnterBackground.
 */
- (void)firebasexCoreApplicationDidEnterBackground:(NSNotification *)notification {
    [self firebasexCoreSetApplicationInBackground:YES];
}

/** Called when a scene becomes active in a scene-based application. */
- (void)firebasexCoreSceneDidBecomeActive:(NSNotification *)notification {
    [self firebasexCoreSetApplicationInBackground:NO];
}

/** Called when a scene enters the background in a scene-based application. */
- (void)firebasexCoreSceneDidEnterBackground:(NSNotification *)notification {
    [self firebasexCoreSetApplicationInBackground:![self firebasexCoreHasActiveScene]];
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
