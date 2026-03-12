/**
 * @file FirebasexCorePlugin.m
 * @brief Implementation of the FirebaseX core Cordova plugin for iOS.
 *
 * Handles Firebase Installations API, global JS execution, structured logging,
 * exception handling, preference management, and plugin result helpers.
 */

#import "FirebasexCorePlugin.h"
#import "AppDelegate+FirebasexCore.h"
#import "FirebasePluginMessageReceiverManager.h"
#import <Cordova/CDV.h>
@import FirebaseCore;
@import FirebaseInstallations;

@implementation FirebasexCorePlugin

/** Prefix for all native log messages from this plugin. */
static NSString *const LOG_TAG = @"FirebasexCore[native]";

/** Shared singleton instance, set during pluginInitialize. */
static FirebasexCorePlugin *sharedInstance;

/** Tracks whether pluginInitialize has completed successfully. */
static BOOL pluginInitialized = NO;

/** Reference to NSUserDefaults for preference flag storage. */
static NSUserDefaults *preferences;

/** Parsed contents of GoogleService-Info.plist for reading config flags. */
static NSDictionary *googlePlist;

/** Cached current installation ID for change detection. */
static NSString *currentInstallationId;

/**
 * Queue of JavaScript strings to execute once the plugin finishes initialisation.
 * Set to @c nil after the queue is drained.
 */
static NSMutableArray *pendingGlobalJS = nil;

+ (FirebasexCorePlugin *)sharedInstance {
    return sharedInstance;
}

/**
 * Called by Cordova when the plugin is first loaded.
 *
 * Stores the singleton reference, loads @c NSUserDefaults and GoogleService-Info.plist,
 * registers a @c FIRInstallationIDDidChangeNotification observer, and drains any
 * pending global JS calls that were queued before initialisation.
 */
- (void)pluginInitialize {
    NSLog(@"Starting FirebasexCorePlugin");
    sharedInstance = self;

    @try {
        preferences = [NSUserDefaults standardUserDefaults];
        googlePlist = [NSMutableDictionary
            dictionaryWithContentsOfFile:[[NSBundle mainBundle]
                                             pathForResource:@"GoogleService-Info"
                                                      ofType:@"plist"]];

        // Initialize installation ID change listener
        __weak __auto_type weakSelf = self;
        self.installationIDObserver = [[NSNotificationCenter defaultCenter]
            addObserverForName:FIRInstallationIDDidChangeNotification
                        object:nil
                         queue:nil
                    usingBlock:^(NSNotification *_Nonnull notification) {
                      [weakSelf sendNewInstallationId];
                    }];

        pluginInitialized = YES;
        [self executePendingGlobalJavascript];
    } @catch (NSException *exception) {
        [self handlePluginExceptionWithoutContext:exception];
    }
}

/*************************************************/
#pragma mark - Plugin actions
/*************************************************/

/**
 * Alias for @c getInstallationId: — provided for backward compatibility with older JS APIs.
 */
- (void)getId:(CDVInvokedUrlCommand *)command {
    [self getInstallationId:command];
}

/**
 * Retrieves the current Firebase Installation ID.
 *
 * Runs asynchronously in the background. On success, returns the ID string
 * to the JS callback; on failure, sends an error result.
 */
- (void)getInstallationId:(CDVInvokedUrlCommand *)command {
    [self.commandDelegate runInBackground:^{
        @try {
            [[FIRInstallations installations]
                installationIDWithCompletion:^(NSString *identifier, NSError *error) {
                    [self handleStringResultWithPotentialError:error
                                                       command:command
                                                        result:identifier];
                }];
        } @catch (NSException *exception) {
            [self handlePluginExceptionWithContext:exception:command];
        }
    }];
}

/**
 * Retrieves a Firebase Installation auth token, forcing a server refresh.
 *
 * On success, returns the auth token string to the JS callback;
 * on failure, sends an error result.
 */
- (void)getInstallationToken:(CDVInvokedUrlCommand *)command {
    [self.commandDelegate runInBackground:^{
        @try {
            [[FIRInstallations installations]
                authTokenForcingRefresh:true
                             completion:^(FIRInstallationsAuthTokenResult *result,
                                          NSError *error) {
                               if (error != nil) {
                                   [self sendPluginErrorWithError:error
                                                          command:command];
                               } else {
                                   [self sendPluginStringResult:[result authToken]
                                                        command:command
                                                     callbackId:command.callbackId];
                               }
                             }];
        } @catch (NSException *exception) {
            [self handlePluginExceptionWithContext:exception:command];
        }
    }];
}

/**
 * Deletes the current Firebase Installation ID.
 *
 * On success, sends an empty success result to the JS callback;
 * on failure, sends an error result.
 */
- (void)deleteInstallationId:(CDVInvokedUrlCommand *)command {
    [self.commandDelegate runInBackground:^{
        @try {
            [[FIRInstallations installations] deleteWithCompletion:^(NSError *error) {
                [self handleEmptyResultWithPotentialError:error command:command];
            }];
        } @catch (NSException *exception) {
            [self handlePluginExceptionWithContext:exception:command];
        }
    }];
}

/**
 * Called when the Installation ID changes.
 *
 * Compares the new ID to the cached @c currentInstallationId and, if different,
 * executes the @c FirebasexCore._onInstallationIdChangeCallback JS function
 * with the new ID.
 */
- (void)sendNewInstallationId {
    [self.commandDelegate runInBackground:^{
        @try {
            [[FIRInstallations installations] installationIDWithCompletion:^(
                                                  NSString *identifier,
                                                  NSError *error) {
                if (error != nil) {
                    [self handlePluginErrorWithoutContext:error];
                } else if (currentInstallationId != identifier) {
                    [self executeGlobalJavascript:
                        [NSString stringWithFormat:@"FirebasexCore._onInstallationIdChangeCallback('%@')",
                                                   identifier]];
                    currentInstallationId = identifier;
                }
            }];
        } @catch (NSException *exception) {
            [self handlePluginExceptionWithoutContext:exception];
        }
    }];
}

/*************************************************/
#pragma mark - Global JS execution
/*************************************************/

/**
 * Evaluates a JavaScript string in the Cordova WebView.
 *
 * If the plugin has not yet finished initialising, the call is added to
 * @c pendingGlobalJS and executed later by @c executePendingGlobalJavascript.
 *
 * @param jsString The JavaScript code to evaluate.
 */
- (void)executeGlobalJavascript:(NSString *)jsString {
    if (pluginInitialized) {
        [self doExecuteGlobalJavascript:jsString];
    } else {
        if (pendingGlobalJS == nil) {
            pendingGlobalJS = [[NSMutableArray alloc] init];
        }
        [pendingGlobalJS addObject:jsString];
    }
}

/**
 * Drains the pending JavaScript queue, executing each string via
 * @c doExecuteGlobalJavascript:, then sets the queue to @c nil.
 */
- (void)executePendingGlobalJavascript {
    if (pendingGlobalJS == nil) {
        NSLog(@"%@ No pending global JS calls", LOG_TAG);
        return;
    }
    NSLog(@"%@ Executing %lu pending global JS calls", LOG_TAG,
          (unsigned long)pendingGlobalJS.count);
    for (NSString *jsString in pendingGlobalJS) {
        [self doExecuteGlobalJavascript:jsString];
    }
    pendingGlobalJS = nil;
}

/**
 * Directly evaluates a JavaScript string via Cordova's @c evalJs:.
 *
 * @param jsString The JavaScript code to evaluate.
 */
- (void)doExecuteGlobalJavascript:(NSString *)jsString {
    [self.commandDelegate evalJs:jsString];
}

/*************************************************/
#pragma mark - Logging
/*************************************************/

/**
 * Logs an error message to NSLog and mirrors it to the WebView's @c console.error.
 *
 * @param msg The message to log.
 */
- (void)_logError:(NSString *)msg {
    NSLog(@"%@ ERROR: %@", LOG_TAG, msg);
    NSString *jsString =
        [NSString stringWithFormat:@"console.error(\"%@: %@\")", LOG_TAG,
                                   [self escapeJavascriptString:msg]];
    [self executeGlobalJavascript:jsString];
}

/**
 * Logs an informational message to NSLog and mirrors it to the WebView's @c console.info.
 *
 * @param msg The message to log.
 */
- (void)_logInfo:(NSString *)msg {
    NSLog(@"%@ INFO: %@", LOG_TAG, msg);
    NSString *jsString =
        [NSString stringWithFormat:@"console.info(\"%@: %@\")", LOG_TAG,
                                   [self escapeJavascriptString:msg]];
    [self executeGlobalJavascript:jsString];
}

/**
 * Logs a general message to NSLog and mirrors it to the WebView's @c console.log.
 *
 * @param msg The message to log.
 */
- (void)_logMessage:(NSString *)msg {
    NSLog(@"%@ LOG: %@", LOG_TAG, msg);
    NSString *jsString =
        [NSString stringWithFormat:@"console.log(\"%@: %@\")", LOG_TAG,
                                   [self escapeJavascriptString:msg]];
    [self executeGlobalJavascript:jsString];
}

/*************************************************/
#pragma mark - Exception handling
/*************************************************/

/**
 * Handles an exception by logging it and sending an error result to the Cordova callback.
 *
 * @param exception The caught @c NSException.
 * @param command   The originating Cordova command (provides the callback ID).
 */
- (void)handlePluginExceptionWithContext:(NSException *)exception
                                        :(CDVInvokedUrlCommand *)command {
    [self handlePluginExceptionWithoutContext:exception];
    CDVPluginResult *pluginResult =
        [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR
                          messageAsString:exception.reason];
    [self.commandDelegate sendPluginResult:pluginResult
                                callbackId:command.callbackId];
}

/**
 * Handles an exception by logging the error message (no Cordova callback).
 *
 * @param exception The caught @c NSException.
 */
- (void)handlePluginExceptionWithoutContext:(NSException *)exception {
    [self _logError:[NSString stringWithFormat:@"EXCEPTION: %@", exception.reason]];
}

/**
 * Handles an @c NSError by logging its description (no Cordova callback).
 *
 * @param error The @c NSError to log.
 */
- (void)handlePluginErrorWithoutContext:(NSError *)error {
    [self _logError:[NSString stringWithFormat:@"ERROR: %@", error.description]];
}

/*************************************************/
#pragma mark - Preferences
/*************************************************/

/**
 * Stores a boolean preference in @c NSUserDefaults and synchronises.
 *
 * @param name The preference key.
 * @param flag The boolean value to store.
 */
- (void)setPreferenceFlag:(NSString *)name flag:(BOOL)flag {
    [preferences setBool:flag forKey:name];
    [preferences synchronize];
}

/**
 * Reads a boolean preference from @c NSUserDefaults.
 *
 * @param name The preference key.
 * @return The stored value, or @c NO if the key does not exist.
 */
- (BOOL)getPreferenceFlag:(NSString *)name {
    if ([preferences objectForKey:name] == nil) {
        return false;
    }
    return [preferences boolForKey:name];
}

/**
 * Reads a boolean flag from GoogleService-Info.plist with a default.
 *
 * Supports both @c NSNumber and string (@c "true"/@c "false") plist values.
 *
 * @param name         The plist key.
 * @param defaultValue The fallback value if the key is missing.
 * @return The plist value as a boolean, or @p defaultValue if absent.
 */
- (BOOL)getGooglePlistFlagWithDefaultValue:(NSString *)name
                              defaultValue:(BOOL)defaultValue {
    if ([googlePlist objectForKey:name] == nil) {
        return defaultValue;
    }
    id value = [googlePlist objectForKey:name];
    if ([value isKindOfClass:[NSNumber class]]) {
        return [value boolValue];
    } else {
        return [value isEqual:@"true"];
    }
}

/*************************************************/
#pragma mark - Result helpers
/*************************************************/

- (void)sendPluginSuccess:(CDVInvokedUrlCommand *)command {
    [self.commandDelegate
        sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK]
              callbackId:command.callbackId];
}

- (void)sendPluginSuccessAndKeepCallback:(NSString *)callbackId {
    CDVPluginResult *pluginResult =
        [CDVPluginResult resultWithStatus:CDVCommandStatus_OK];
    [pluginResult setKeepCallbackAsBool:YES];
    [self.commandDelegate sendPluginResult:pluginResult callbackId:callbackId];
}

- (void)sendPluginSuccessAndKeepCallback:(NSString *)callbackId command:(id<CDVCommandDelegate>)commandDelegate {
    CDVPluginResult *pluginResult =
        [CDVPluginResult resultWithStatus:CDVCommandStatus_OK];
    [pluginResult setKeepCallbackAsBool:YES];
    [commandDelegate sendPluginResult:pluginResult callbackId:callbackId];
}

- (void)sendPluginNoResult:(CDVInvokedUrlCommand *)command
                callbackId:(NSString *)callbackId {
    CDVPluginResult *pluginResult =
        [CDVPluginResult resultWithStatus:CDVCommandStatus_NO_RESULT];
    [self.commandDelegate sendPluginResult:pluginResult callbackId:callbackId];
}

- (void)sendPluginNoResultAndKeepCallback:(CDVInvokedUrlCommand *)command
                               callbackId:(NSString *)callbackId {
    CDVPluginResult *pluginResult =
        [CDVPluginResult resultWithStatus:CDVCommandStatus_NO_RESULT];
    [pluginResult setKeepCallbackAsBool:YES];
    [self.commandDelegate sendPluginResult:pluginResult callbackId:callbackId];
}

- (void)sendPluginStringResult:(NSString *)result
                       command:(CDVInvokedUrlCommand *)command
                    callbackId:(NSString *)callbackId {
    CDVPluginResult *pluginResult =
        [CDVPluginResult resultWithStatus:CDVCommandStatus_OK
                          messageAsString:result];
    [self.commandDelegate sendPluginResult:pluginResult callbackId:callbackId];
}

- (void)sendPluginStringResultAndKeepCallback:(NSString *)result
                                      command:(CDVInvokedUrlCommand *)command
                                   callbackId:(NSString *)callbackId {
    CDVPluginResult *pluginResult =
        [CDVPluginResult resultWithStatus:CDVCommandStatus_OK
                          messageAsString:result];
    [pluginResult setKeepCallbackAsBool:YES];
    [self.commandDelegate sendPluginResult:pluginResult callbackId:callbackId];
}

- (void)sendPluginBoolResult:(BOOL)result
                     command:(CDVInvokedUrlCommand *)command
                  callbackId:(NSString *)callbackId {
    CDVPluginResult *pluginResult =
        [CDVPluginResult resultWithStatus:CDVCommandStatus_OK
                            messageAsBool:result];
    [self.commandDelegate sendPluginResult:pluginResult callbackId:callbackId];
}

- (void)sendPluginBoolResultAndKeepCallback:(BOOL)result
                                    command:(CDVInvokedUrlCommand *)command
                                 callbackId:(NSString *)callbackId {
    CDVPluginResult *pluginResult =
        [CDVPluginResult resultWithStatus:CDVCommandStatus_OK
                            messageAsBool:result];
    [pluginResult setKeepCallbackAsBool:YES];
    [self.commandDelegate sendPluginResult:pluginResult callbackId:callbackId];
}

- (void)sendPluginDictionaryResult:(NSDictionary *)result
                           command:(CDVInvokedUrlCommand *)command
                        callbackId:(NSString *)callbackId {
    CDVPluginResult *pluginResult =
        [CDVPluginResult resultWithStatus:CDVCommandStatus_OK
                      messageAsDictionary:result];
    [self.commandDelegate sendPluginResult:pluginResult callbackId:callbackId];
}

- (void)sendPluginDictionaryResultAndKeepCallback:(NSDictionary *)result
                                          command:(CDVInvokedUrlCommand *)command
                                       callbackId:(NSString *)callbackId {
    CDVPluginResult *pluginResult =
        [CDVPluginResult resultWithStatus:CDVCommandStatus_OK
                      messageAsDictionary:result];
    [pluginResult setKeepCallbackAsBool:YES];
    [self.commandDelegate sendPluginResult:pluginResult callbackId:callbackId];
}

- (void)sendPluginArrayResult:(NSArray *)result
                      command:(CDVInvokedUrlCommand *)command
                   callbackId:(NSString *)callbackId {
    CDVPluginResult *pluginResult =
        [CDVPluginResult resultWithStatus:CDVCommandStatus_OK
                           messageAsArray:result];
    [self.commandDelegate sendPluginResult:pluginResult callbackId:callbackId];
}

- (void)sendPluginArrayResultAndKeepCallback:(NSArray *)result
                                     command:(CDVInvokedUrlCommand *)command
                                  callbackId:(NSString *)callbackId {
    CDVPluginResult *pluginResult =
        [CDVPluginResult resultWithStatus:CDVCommandStatus_OK
                           messageAsArray:result];
    [pluginResult setKeepCallbackAsBool:YES];
    [self.commandDelegate sendPluginResult:pluginResult callbackId:callbackId];
}

- (void)sendPluginError:(CDVInvokedUrlCommand *)command {
    [self.commandDelegate
        sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR]
              callbackId:command.callbackId];
}

- (void)sendPluginErrorWithMessage:(NSString *)errorMessage
                                  :(CDVInvokedUrlCommand *)command {
    CDVPluginResult *pluginResult =
        [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR
                          messageAsString:errorMessage];
    [self _logError:errorMessage];
    [self.commandDelegate sendPluginResult:pluginResult
                                callbackId:command.callbackId];
}

- (void)sendPluginErrorWithError:(NSError *)error
                         command:(CDVInvokedUrlCommand *)command {
    [self.commandDelegate
        sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR
                                           messageAsString:error.description]
              callbackId:command.callbackId];
}

- (void)handleEmptyResultWithPotentialError:(NSError *)error
                                    command:(CDVInvokedUrlCommand *)command {
    if (error) {
        [self sendPluginErrorWithError:error command:command];
    } else {
        [self sendPluginSuccess:command];
    }
}

- (void)handleStringResultWithPotentialError:(NSError *)error
                                     command:(CDVInvokedUrlCommand *)command
                                      result:(NSString *)result {
    if (error) {
        [self sendPluginErrorWithError:error command:command];
    } else {
        [self sendPluginStringResult:result
                             command:command
                          callbackId:command.callbackId];
    }
}

- (void)handleBoolResultWithPotentialError:(NSError *)error
                                   command:(CDVInvokedUrlCommand *)command
                                    result:(BOOL)result {
    if (error) {
        [self sendPluginErrorWithError:error command:command];
    } else {
        [self sendPluginBoolResult:result
                           command:command
                        callbackId:command.callbackId];
    }
}

/*************************************************/
#pragma mark - Thread helpers
/*************************************************/

/**
 * Executes a block synchronously on the main thread.
 *
 * If already on the main thread, the block runs immediately. Otherwise,
 * @c dispatch_sync is used. Exceptions are caught and logged.
 *
 * @param completeBlock The block to execute on the main thread.
 */
- (void)runOnMainThread:(void (^)(void))completeBlock {
    if (![NSThread isMainThread]) {
        dispatch_sync(dispatch_get_main_queue(), ^{
            @try {
                completeBlock();
            } @catch (NSException *exception) {
                [self handlePluginExceptionWithoutContext:exception];
            }
        });
    } else {
        @try {
            completeBlock();
        } @catch (NSException *exception) {
            [self handlePluginExceptionWithoutContext:exception];
        }
    }
}

/*************************************************/
#pragma mark - String helpers
/*************************************************/

/**
 * Escapes a string for safe embedding in a JavaScript string literal.
 *
 * Handles double-quote escaping (avoiding double-escaping already escaped quotes)
 * and newline escaping.
 *
 * @param str The raw Objective-C string.
 * @return The escaped string safe for JavaScript injection.
 */
- (NSString *)escapeJavascriptString:(NSString *)str {
    NSString *result = [str stringByReplacingOccurrencesOfString:@"\\\""
                                                      withString:@"\""];
    result = [result stringByReplacingOccurrencesOfString:@"\""
                                               withString:@"\\\""];
    result = [result stringByReplacingOccurrencesOfString:@"\n"
                                               withString:@"\\\n"];
    return result;
}

@end
