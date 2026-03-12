/**
 * @file FirebasexCorePlugin.h
 * @brief Core Cordova plugin for FirebaseX on iOS.
 *
 * Provides shared utilities, Firebase Installations API, logging, exception handling,
 * result helper methods, and preference management used by all feature-specific
 * FirebaseX Cordova plugins.
 *
 * This plugin is initialised automatically by Cordova and exposes a shared singleton
 * instance that feature plugins access via @c +sharedInstance.
 */

#import "AppDelegate.h"
#import <Cordova/CDV.h>
@import FirebaseCore;
@import FirebaseInstallations;

NS_ASSUME_NONNULL_BEGIN

/**
 * Central Cordova plugin class for the modular FirebaseX core module.
 *
 * Responsibilities:
 * - Firebase Installations API (ID retrieval, token, deletion, change listener)
 * - Global JavaScript execution into the Cordova WebView
 * - Structured logging (error / info / message) with WebView console mirroring
 * - Exception and error handling with Cordova callback integration
 * - @c NSUserDefaults preference flag management
 * - GoogleService-Info.plist flag reading
 * - Thread-safe main-thread dispatch
 * - Plugin result convenience methods for all Cordova data types
 *
 * Feature plugins (messaging, analytics, auth, etc.) obtain this instance via
 * @c +sharedInstance and call its helper methods to avoid code duplication.
 */
@interface FirebasexCorePlugin : CDVPlugin

/**
 * Returns the shared singleton instance of the core plugin.
 *
 * @return The initialised @c FirebasexCorePlugin instance, or @c nil if the plugin
 *         has not yet been initialised by Cordova.
 */
+ (FirebasexCorePlugin * _Nullable)sharedInstance;

#pragma mark - Installations

/** Retrieves the Firebase Installation ID and returns it to the JS callback. */
- (void)getInstallationId:(CDVInvokedUrlCommand *)command;
/** Retrieves a Firebase Installation auth token (force-refreshed) and returns it to JS. */
- (void)getInstallationToken:(CDVInvokedUrlCommand *)command;
/** Deletes the current Firebase Installation ID. */
- (void)deleteInstallationId:(CDVInvokedUrlCommand *)command;
/** Alias for @c getInstallationId: — provided for backward compatibility. */
- (void)getId:(CDVInvokedUrlCommand *)command;

#pragma mark - Global JavaScript Execution

/**
 * Evaluates a JavaScript string in the Cordova WebView.
 *
 * If the plugin has not yet finished initialising, the call is queued and
 * executed when @c executePendingGlobalJavascript is called.
 *
 * @param jsString The JavaScript code to evaluate.
 */
- (void)executeGlobalJavascript:(NSString *)jsString;

/**
 * Executes all queued JavaScript calls that were deferred before plugin initialisation.
 */
- (void)executePendingGlobalJavascript;

#pragma mark - Exception / Error Handling

/**
 * Handles an exception and sends an error result to the given Cordova command's callback.
 *
 * @param exception The caught @c NSException.
 * @param command   The originating Cordova command.
 */
- (void)handlePluginExceptionWithContext:(NSException *)exception :(CDVInvokedUrlCommand *)command;

/**
 * Handles an exception with logging only (no Cordova callback).
 *
 * @param exception The caught @c NSException.
 */
- (void)handlePluginExceptionWithoutContext:(NSException *)exception;

/**
 * Handles an @c NSError with logging only (no Cordova callback).
 *
 * @param error The error to log.
 */
- (void)handlePluginErrorWithoutContext:(NSError *)error;

#pragma mark - Logging

/** Logs an error message to the native console and mirrors it to the WebView console. */
- (void)_logError:(NSString *)msg;
/** Logs an informational message to the native console and mirrors it to the WebView console. */
- (void)_logInfo:(NSString *)msg;
/** Logs a general message to the native console and mirrors it to the WebView console. */
- (void)_logMessage:(NSString *)msg;

#pragma mark - Preferences

/**
 * Stores a boolean preference flag in @c NSUserDefaults.
 *
 * @param name The preference key.
 * @param flag The boolean value to store.
 */
- (void)setPreferenceFlag:(NSString *)name flag:(BOOL)flag;

/**
 * Retrieves a boolean preference flag from @c NSUserDefaults.
 *
 * @param name The preference key.
 * @return The stored boolean value, or @c NO if the key does not exist.
 */
- (BOOL)getPreferenceFlag:(NSString *)name;

/**
 * Reads a boolean flag from the GoogleService-Info.plist.
 *
 * @param name         The plist key.
 * @param defaultValue The value returned if the key is not present.
 * @return The plist value as a boolean, or @p defaultValue if missing.
 */
- (BOOL)getGooglePlistFlagWithDefaultValue:(NSString *)name defaultValue:(BOOL)defaultValue;

#pragma mark - Result Helpers

/** Sends an OK result with no data. */
- (void)sendPluginSuccess:(CDVInvokedUrlCommand *)command;
/** Sends an OK result with no data and keeps the callback alive for future invocations. */
- (void)sendPluginSuccessAndKeepCallback:(NSString *)callbackId;
/**
 * Sends an OK result using the specified command delegate, keeping the callback alive.
 *
 * Use this variant when the callbackId belongs to a different plugin's command delegate
 * (e.g. a feature plugin calling into the core helper).
 *
 * @param callbackId      The callback ID to send the result to.
 * @param commandDelegate The @c CDVCommandDelegate that owns the callback.
 */
- (void)sendPluginSuccessAndKeepCallback:(NSString *)callbackId command:(id<CDVCommandDelegate>)commandDelegate;
/** Sends a NO_RESULT status (callback is disposed). */
- (void)sendPluginNoResult:(CDVInvokedUrlCommand *)command callbackId:(NSString *)callbackId;
/** Sends a NO_RESULT status and keeps the callback alive. */
- (void)sendPluginNoResultAndKeepCallback:(CDVInvokedUrlCommand *)command callbackId:(NSString *)callbackId;
/** Sends a string result. */
- (void)sendPluginStringResult:(NSString *)result command:(CDVInvokedUrlCommand *)command callbackId:(NSString *)callbackId;
/** Sends a string result and keeps the callback alive. */
- (void)sendPluginStringResultAndKeepCallback:(NSString *)result command:(CDVInvokedUrlCommand *)command callbackId:(NSString *)callbackId;
/** Sends a boolean result. */
- (void)sendPluginBoolResult:(BOOL)result command:(CDVInvokedUrlCommand *)command callbackId:(NSString *)callbackId;
/** Sends a boolean result and keeps the callback alive. */
- (void)sendPluginBoolResultAndKeepCallback:(BOOL)result command:(CDVInvokedUrlCommand *)command callbackId:(NSString *)callbackId;
/** Sends a dictionary (JSON object) result. */
- (void)sendPluginDictionaryResult:(NSDictionary *)result command:(CDVInvokedUrlCommand *)command callbackId:(NSString *)callbackId;
/** Sends a dictionary result and keeps the callback alive. */
- (void)sendPluginDictionaryResultAndKeepCallback:(NSDictionary *)result command:(CDVInvokedUrlCommand *)command callbackId:(NSString *)callbackId;
/** Sends an array (JSON array) result. */
- (void)sendPluginArrayResult:(NSArray *)result command:(CDVInvokedUrlCommand *)command callbackId:(NSString *)callbackId;
/** Sends an array result and keeps the callback alive. */
- (void)sendPluginArrayResultAndKeepCallback:(NSArray *)result command:(CDVInvokedUrlCommand *)command callbackId:(NSString *)callbackId;
/** Sends a generic error result with no message. */
- (void)sendPluginError:(CDVInvokedUrlCommand *)command;
/** Sends an error result with a descriptive message string. */
- (void)sendPluginErrorWithMessage:(NSString *)errorMessage :(CDVInvokedUrlCommand *)command;
/** Sends an error result using an @c NSError's description. */
- (void)sendPluginErrorWithError:(NSError *)error command:(CDVInvokedUrlCommand *)command;
/** Sends success if @p error is nil, otherwise sends an error result. */
- (void)handleEmptyResultWithPotentialError:(NSError *)error command:(CDVInvokedUrlCommand *)command;
/** Sends a string result if @p error is nil, otherwise sends an error result. */
- (void)handleStringResultWithPotentialError:(NSError *)error command:(CDVInvokedUrlCommand *)command result:(NSString *)result;
/** Sends a boolean result if @p error is nil, otherwise sends an error result. */
- (void)handleBoolResultWithPotentialError:(NSError *)error command:(CDVInvokedUrlCommand *)command result:(BOOL)result;

#pragma mark - Thread Helpers

/**
 * Executes a block synchronously on the main thread.
 *
 * If already on the main thread, the block runs immediately.
 * Any exception thrown by the block is caught and logged.
 *
 * @param completeBlock The block to execute.
 */
- (void)runOnMainThread:(void (^)(void))completeBlock;

#pragma mark - String Helpers

/**
 * Escapes a string for safe embedding inside a JavaScript string literal.
 *
 * Handles double quotes and newlines.
 *
 * @param str The raw string.
 * @return The escaped string safe for JavaScript injection.
 */
- (NSString *)escapeJavascriptString:(NSString *)str;

/**
 * Observer token for Firebase Installation ID change notifications.
 *
 * Retained for the lifetime of the plugin so the observer can be removed on dealloc.
 */
@property(nonatomic, nullable) id<NSObject> installationIDObserver;

@end

NS_ASSUME_NONNULL_END
