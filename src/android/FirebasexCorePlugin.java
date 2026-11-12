package org.apache.cordova.firebasex;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;

import androidx.annotation.NonNull;

import com.google.android.gms.tasks.OnCompleteListener;
import com.google.android.gms.tasks.Task;
import com.google.firebase.FirebaseApp;
import com.google.firebase.installations.FirebaseInstallations;
import com.google.firebase.installations.InstallationTokenResult;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaInterface;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.CordovaWebView;
import org.apache.cordova.PluginResult;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.lang.reflect.Method;
import java.util.ArrayList;

import static android.content.Context.MODE_PRIVATE;

/**
 * Core Cordova plugin for the modular FirebaseX plugin suite (Android).
 *
 * <p>This plugin is the foundation of all other FirebaseX modular plugins. It handles:
 * <ul>
 *   <li>Firebase SDK initialization via {@link com.google.firebase.FirebaseApp}</li>
 *   <li>Firebase Installations API (FID retrieval, token retrieval, deletion)</li>
 *   <li>Application lifecycle events (foreground/background transitions)</li>
 *   <li>Global JavaScript execution bridge for native-to-JS communication</li>
 *   <li>Shared utility methods used by all feature plugins (error handling,
 *       preferences, permissions, plugin result helpers)</li>
 * </ul>
 *
 * <p>Feature plugins (messaging, analytics, auth, etc.) depend on this plugin
 * and access its singleton instance via {@link #getInstance()}.
 *
 * @see <a href="https://firebase.google.com/docs/projects/manage-installations">Firebase Installations</a>
 */
public class FirebasexCorePlugin extends CordovaPlugin {

    /** Singleton instance, set during {@link #pluginInitialize()}. */
    protected static FirebasexCorePlugin instance = null;
    /**
     * Application context, cached for use by feature plugins. It is the {@code Application}
     * object, so unlike the activity references below it stays set after {@link #onDestroy()}.
     */
    protected static Context applicationContext = null;
    /** Reference to the hosting Cordova activity. */
    private static Activity cordovaActivity = null;
    /** Reference to the Cordova interface for permission requests etc. */
    private static CordovaInterface cordovaInterface = null;
    /** Whether {@link #pluginInitialize()} has completed. */
    private static boolean pluginInitialized = false;
    /** Whether the Cordova WebView has finished loading the page. */
    private static boolean onPageFinished = false;
    /** Whether the application is currently in the background. */
    private static boolean inBackground = true;
    /** Queue of JavaScript strings to execute once both plugin init and page load finish. */
    private static ArrayList<String> pendingGlobalJS = null;

    /** Log tag used for all core plugin log messages. */
    protected static final String TAG = "FirebasexCore";
    /** JavaScript global namespace prefix for native-to-JS callbacks. */
    protected static final String JS_GLOBAL_NAMESPACE = "FirebasexCore.";
    /** SharedPreferences name for persisting plugin settings. */
    protected static final String SETTINGS_NAME = "firebasex_settings";

    /**
     * Returns the singleton instance of this plugin.
     *
     * <p>Feature plugins use this to access shared utilities such as
     * {@link #executeGlobalJavascript(String)}, error handling, and preferences.
     *
     * @return the plugin instance, or {@code null} before initialization or after destruction
     */
    public static FirebasexCorePlugin getInstance() {
        return instance;
    }

    /**
     * Indicates whether the application is currently in the background.
     *
     * @return {@code true} if the app is backgrounded, {@code false} if in the foreground
     */
    public static boolean isApplicationInBackground() {
        return inBackground;
    }

    /**
     * Indicates whether the Cordova WebView has finished loading the initial page.
     *
     * <p>Used to determine if it is safe to execute JavaScript in the WebView.
     *
     * @return {@code true} if the page has finished loading
     */
    public static boolean isPageFinished() {
        return onPageFinished;
    }

    /**
     * Returns the cached application context.
     *
     * @return the Android application context, or {@code null} before initialization
     */
    public static Context getApplicationContext() {
        return applicationContext;
    }

    /**
     * Returns the hosting Cordova activity.
     *
     * @return the activity, or {@code null} before initialization or after destruction
     */
    public static Activity getCordovaActivity() {
        return cordovaActivity;
    }

    /**
     * Called by Cordova when the plugin is initialized.
     *
     * <p>Performs the following setup:
     * <ol>
     *   <li>Caches the singleton instance, activity, and application context</li>
     *   <li>Initializes the Firebase SDK via {@link FirebaseApp#initializeApp(Context)}</li>
     *   <li>Executes any pending global JavaScript calls once the page is ready</li>
     * </ol>
     */
    @Override
    protected void pluginInitialize() {
        instance = this;
        cordovaActivity = this.cordova.getActivity();
        applicationContext = cordovaActivity.getApplicationContext();
        cordovaInterface = this.cordova;

        Log.d(TAG, "Starting Firebasex Core plugin");
        FirebaseApp.initializeApp(applicationContext);

        this.cordova.getThreadPool().execute(new Runnable() {
            public void run() {
                try {
                    pluginInitialized = true;
                    if (onPageFinished) {
                        executePendingGlobalJavascript();
                    }
                } catch (Exception e) {
                    handleExceptionWithoutContext(e);
                }
            }
        });
    }

    /**
     * Handles Cordova system messages.
     *
     * <p>Listens for the {@code "onPageFinished"} message to know when the WebView is ready
     * for JavaScript execution. Once received, any pending global JS calls are flushed.
     *
     * @param id   the message identifier
     * @param data optional message payload
     * @return the result of message handling, or the superclass result for unhandled messages
     */
    @Override
    public Object onMessage(String id, Object data) {
        if (id == null) {
            return super.onMessage(id, data);
        }
        if ("onPageFinished".equals(id)) {
            Log.d(TAG, "Page ready init javascript");
            onPageFinished = true;
            executePendingGlobalJavascript();
            return null;
        }
        return super.onMessage(id, data);
    }

    /**
     * Dispatches actions from the JavaScript bridge to native methods.
     *
     * <p>Supported actions:
     * <ul>
     *   <li>{@code "getInstallationId"} - retrieves the Firebase Installation ID</li>
     *   <li>{@code "getInstallationToken"} - retrieves a Firebase Installation auth token</li>
     *   <li>{@code "deleteInstallationId"} - deletes the Firebase Installation</li>
     * </ul>
     *
     * @param action          the action name from JavaScript
     * @param args            the arguments array from JavaScript
     * @param callbackContext the callback for returning results to JavaScript
     * @return {@code true} if the action was recognized, {@code false} otherwise
     * @throws JSONException if argument parsing fails
     */
    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        try {
            switch (action) {
                case "getInstallationId":
                    this.getInstallationId(callbackContext);
                    break;
                case "getInstallationToken":
                    this.getInstallationToken(callbackContext);
                    break;
                case "deleteInstallationId":
                    this.deleteInstallationId(callbackContext);
                    break;
                default:
                    callbackContext.error("Invalid action: " + action);
                    return false;
            }
        } catch (Exception e) {
            handleExceptionWithContext(e, callbackContext);
            return false;
        }
        return true;
    }

    /**
     * Called when the app transitions to the background.
     * Updates the background state flag and broadcasts a {@code FirebasexAppDidEnterBackground}
     * event via {@link FirebasexEventBus} so feature plugins can react.
     */
    @Override
    public void onPause(boolean multitasking) {
        inBackground = true;
        FirebasexEventBus.broadcast(applicationContext, "FirebasexAppDidEnterBackground", null);
    }

    /**
     * Called when the app transitions to the foreground.
     * Updates the background state flag and broadcasts a {@code FirebasexAppDidBecomeActive}
     * event via {@link FirebasexEventBus} so feature plugins can react.
     */
    @Override
    public void onResume(boolean multitasking) {
        inBackground = false;
        FirebasexEventBus.broadcast(applicationContext, "FirebasexAppDidBecomeActive", null);
    }

    /** Called when the WebView navigates to a new page. Subclasses may override for cleanup. */
    @Override
    public void onReset() {
        // Subclasses or other plugins can override
    }

    /**
     * Clears the static references to this instance when the plugin is destroyed.
     *
     * <p>A newer activity may already own them: when one {@code MainActivity} replaces another
     * (a second instance opened from another app's task, {@code FLAG_ACTIVITY_CLEAR_TASK}), Android
     * runs the old activity's {@code onDestroy()} after the new activity's {@code onCreate()}.
     * Clearing them then would leave the live page without a core plugin until the process ends.
     *
     * <p>{@link #applicationContext} is kept because it does not belong to the activity, and calls
     * from the page can still arrive on other threads while the activity is being destroyed.
     */
    @Override
    public void onDestroy() {
        if (instance == this) {
            instance = null;
            cordovaActivity = null;
            cordovaInterface = null;
        }
        onReset();
        super.onDestroy();
    }

    /***********************************************
     * Installations API
     ***********************************************/

    /**
     * Retrieves the Firebase Installation ID (FID) asynchronously.
     *
     * <p>The FID uniquely identifies this app installation. It may change on reinstall or data clear.
     *
     * @param callbackContext receives the FID string on success, or an error message on failure
     */
    private void getInstallationId(final CallbackContext callbackContext) {
        cordova.getThreadPool().execute(new Runnable() {
            public void run() {
                try {
                    FirebaseInstallations.getInstance().getId()
                        .addOnCompleteListener(new OnCompleteListener<String>() {
                            @Override
                            public void onComplete(@NonNull Task<String> task) {
                                try {
                                    if (task.isSuccessful()) {
                                        callbackContext.success(task.getResult());
                                    } else if (task.getException() != null) {
                                        callbackContext.error(task.getException().getMessage());
                                    } else {
                                        callbackContext.error("Failed to get installation ID");
                                    }
                                } catch (Exception e) {
                                    handleExceptionWithContext(e, callbackContext);
                                }
                            }
                        });
                } catch (Exception e) {
                    handleExceptionWithContext(e, callbackContext);
                }
            }
        });
    }

    /**
     * Retrieves a Firebase Installation auth token, forcing a refresh.
     *
     * <p>The token can be used to authenticate this app instance against backend services.
     *
     * @param callbackContext receives the token string on success, or an error message on failure
     */
    private void getInstallationToken(final CallbackContext callbackContext) {
        cordova.getThreadPool().execute(new Runnable() {
            public void run() {
                try {
                    FirebaseInstallations.getInstance().getToken(true)
                        .addOnCompleteListener(new OnCompleteListener<InstallationTokenResult>() {
                            @Override
                            public void onComplete(@NonNull Task<InstallationTokenResult> task) {
                                try {
                                    if (task.isSuccessful()) {
                                        callbackContext.success(task.getResult().getToken());
                                    } else if (task.getException() != null) {
                                        callbackContext.error(task.getException().getMessage());
                                    } else {
                                        callbackContext.error("Failed to get installation token");
                                    }
                                } catch (Exception e) {
                                    handleExceptionWithContext(e, callbackContext);
                                }
                            }
                        });
                } catch (Exception e) {
                    handleExceptionWithContext(e, callbackContext);
                }
            }
        });
    }

    /**
     * Deletes the current Firebase Installation ID and associated data.
     *
     * <p>A new FID will be generated on next access. This can be used for user opt-out
     * or data deletion flows.
     *
     * @param callbackContext receives success on completion, or an error message on failure
     */
    private void deleteInstallationId(final CallbackContext callbackContext) {
        cordova.getThreadPool().execute(new Runnable() {
            public void run() {
                try {
                    FirebaseInstallations.getInstance().delete()
                        .addOnCompleteListener(new OnCompleteListener<Void>() {
                            @Override
                            public void onComplete(@NonNull Task<Void> task) {
                                try {
                                    if (task.isSuccessful()) {
                                        callbackContext.success();
                                    } else if (task.getException() != null) {
                                        callbackContext.error(task.getException().getMessage());
                                    } else {
                                        callbackContext.error("Failed to delete installation ID");
                                    }
                                } catch (Exception e) {
                                    handleExceptionWithContext(e, callbackContext);
                                }
                            }
                        });
                } catch (Exception e) {
                    handleExceptionWithContext(e, callbackContext);
                }
            }
        });
    }

    /***********************************************
     * Utility methods shared across plugins
     ***********************************************/

    /**
     * Executes a JavaScript string in the Cordova WebView.
     *
     * <p>If the plugin is not yet initialized or the page has not finished loading,
     * the JavaScript call is queued and executed later via {@link #executePendingGlobalJavascript()}.
     *
     * <p>This is the primary mechanism for native-to-JS communication (e.g., firing event
     * callbacks). Feature plugins call this to push data and events to the JS layer.
     *
     * @param jsString the JavaScript code to evaluate in the WebView
     */
    public void executeGlobalJavascript(final String jsString) {
        if (pluginInitialized && onPageFinished) {
            doExecuteGlobalJavascript(jsString);
            return;
        }
        synchronized (FirebasexCorePlugin.class) {
            if (pendingGlobalJS == null) {
                pendingGlobalJS = new ArrayList<>();
            }
            pendingGlobalJS.add(jsString);
        }
    }

    /**
     * Flushes all queued JavaScript calls once the plugin and page are both ready.
     * Called from {@link #pluginInitialize()} and {@link #onMessage(String, Object)}.
     */
    private void executePendingGlobalJavascript() {
        if (!pluginInitialized || !onPageFinished) {
            return;
        }
        ArrayList<String> toExecute;
        synchronized (FirebasexCorePlugin.class) {
            if (pendingGlobalJS == null) return;
            toExecute = pendingGlobalJS;
            pendingGlobalJS = null;
        }
        for (String jsString : toExecute) {
            doExecuteGlobalJavascript(jsString);
        }
    }

    /**
     * Evaluates a JavaScript string on the UI thread.
     *
     * <p>Tries {@code evaluateJavascript()} first, falling back to {@code loadUrl("javascript:...")}.
     *
     * @param jsString the JavaScript code to evaluate
     */
    private void doExecuteGlobalJavascript(final String jsString) {
        // Read once: onDestroy() can clear the static on the UI thread while a pool thread is here.
        final Activity activity = cordovaActivity;
        if (activity == null) return;
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    webView.getEngine().evaluateJavascript(jsString, null);
                } catch (Throwable t) {
                    try {
                        webView.loadUrl("javascript:" + jsString);
                    } catch (Throwable t2) {
                        Log.e(TAG, "Failed to execute JS: " + t2.getMessage());
                    }
                }
            }
        });
    }

    /**
     * Handles an exception by logging it, recording it to Crashlytics (if available),
     * and sending an error result to the JavaScript callback.
     *
     * @param e       the exception that occurred
     * @param context the Cordova callback context to receive the error
     */
    public static void handleExceptionWithContext(Exception e, CallbackContext context) {
        String msg = e.toString();
        Log.e(TAG, msg);
        logExceptionToCrashlyticsIfAvailable(e);
        context.error(msg);
    }

    /**
     * Handles an exception when no callback context is available.
     *
     * <p>Logs the error, records it to Crashlytics (if available), and outputs
     * an error message to the WebView console.
     *
     * @param e the exception that occurred
     */
    public static void handleExceptionWithoutContext(Exception e) {
        String msg = e.toString();
        Log.e(TAG, msg);
        logExceptionToCrashlyticsIfAvailable(e);
        // Read once: onDestroy() can clear the static on the UI thread while a pool thread is here.
        final FirebasexCorePlugin plugin = instance;
        if (plugin != null) {
            plugin.logErrorToWebview(msg);
        }
    }

    /**
     * Attempts to record an exception to Firebase Crashlytics using reflection.
     *
     * <p>This avoids a hard dependency on the Crashlytics module; if it is not installed,
     * the exception is silently ignored.
     *
     * @param e the exception to record
     */
    private static void logExceptionToCrashlyticsIfAvailable(Exception e) {
        try {
            Class<?> crashlyticsClass = Class.forName("com.google.firebase.crashlytics.FirebaseCrashlytics");
            Object crashlytics = crashlyticsClass.getMethod("getInstance").invoke(null);
            crashlyticsClass.getMethod("recordException", Throwable.class).invoke(crashlytics, e);
        } catch (Exception ignored) {
            // Crashlytics not available
        }
    }

    /**
     * Logs an error message to both the native log and the WebView JavaScript console.
     *
     * @param msg the error message to log
     */
    public void logErrorToWebview(String msg) {
        Log.e(TAG, msg);
        executeGlobalJavascript("console.error(\"" + TAG + "[native]: " + escapeDoubleQuotes(msg) + "\")");
    }

    /**
     * Escapes double-quote characters in a string for safe embedding in JavaScript.
     *
     * @param string the input string
     * @return the escaped string
     */
    private String escapeDoubleQuotes(String string) {
        String escapedString = string.replace("\"", "\\\"");
        escapedString = escapedString.replace("%22", "\\%22");
        return escapedString;
    }

    /**
     * Sends a string result to JavaScript and keeps the callback alive for future calls.
     *
     * @param result          the string value to send
     * @param callbackContext the callback context
     */
    public void sendPluginResultAndKeepCallback(String result, CallbackContext callbackContext) {
        PluginResult pluginresult = new PluginResult(PluginResult.Status.OK, result);
        sendPluginResultAndKeepCallback(pluginresult, callbackContext);
    }

    /**
     * Sends a boolean result to JavaScript and keeps the callback alive.
     *
     * @param result          the boolean value to send
     * @param callbackContext the callback context
     */
    public void sendPluginResultAndKeepCallback(boolean result, CallbackContext callbackContext) {
        PluginResult pluginresult = new PluginResult(PluginResult.Status.OK, result);
        sendPluginResultAndKeepCallback(pluginresult, callbackContext);
    }

    /**
     * Sends an integer result to JavaScript and keeps the callback alive.
     *
     * @param result          the integer value to send
     * @param callbackContext the callback context
     */
    public void sendPluginResultAndKeepCallback(int result, CallbackContext callbackContext) {
        PluginResult pluginresult = new PluginResult(PluginResult.Status.OK, result);
        sendPluginResultAndKeepCallback(pluginresult, callbackContext);
    }

    /**
     * Sends a JSON array result to JavaScript and keeps the callback alive.
     *
     * @param result          the JSON array to send
     * @param callbackContext the callback context
     */
    public void sendPluginResultAndKeepCallback(JSONArray result, CallbackContext callbackContext) {
        PluginResult pluginresult = new PluginResult(PluginResult.Status.OK, result);
        sendPluginResultAndKeepCallback(pluginresult, callbackContext);
    }

    /**
     * Sends a JSON object result to JavaScript and keeps the callback alive.
     *
     * @param result          the JSON object to send
     * @param callbackContext the callback context
     */
    public void sendPluginResultAndKeepCallback(JSONObject result, CallbackContext callbackContext) {
        PluginResult pluginresult = new PluginResult(PluginResult.Status.OK, result);
        sendPluginResultAndKeepCallback(pluginresult, callbackContext);
    }

    /**
     * Sends a NO_RESULT status to JavaScript and keeps the callback alive.
     * Used for persistent listeners that will receive multiple callbacks.
     *
     * @param callbackContext the callback context
     */
    public void sendEmptyPluginResultAndKeepCallback(CallbackContext callbackContext) {
        PluginResult pluginresult = new PluginResult(PluginResult.Status.NO_RESULT);
        pluginresult.setKeepCallback(true);
        callbackContext.sendPluginResult(pluginresult);
    }

    /**
     * Sends a pre-built plugin result to JavaScript and keeps the callback alive.
     *
     * @param pluginresult    the result to send
     * @param callbackContext the callback context
     */
    public void sendPluginResultAndKeepCallback(PluginResult pluginresult, CallbackContext callbackContext) {
        pluginresult.setKeepCallback(true);
        callbackContext.sendPluginResult(pluginresult);
    }

    /***********************************************
     * SharedPreferences helpers
     ***********************************************/

    /**
     * Reads a boolean metadata value from the Android manifest.
     *
     * <p>Used to read plugin variables that are injected into {@code AndroidManifest.xml}
     * at build time (e.g., {@code FIREBASE_ANALYTICS_COLLECTION_ENABLED}).
     *
     * @param name the metadata key name
     * @return the boolean value from the manifest
     * @throws Exception if the metadata cannot be read
     */
    public static boolean getMetaDataFromManifest(String name) throws Exception {
        return applicationContext.getPackageManager()
            .getApplicationInfo(applicationContext.getPackageName(), PackageManager.GET_META_DATA)
            .metaData.getBoolean(name);
    }

    /**
     * Reads a plugin variable (preference) from Cordova's config.xml.
     *
     * @param name the preference name as defined in plugin.xml
     * @return the preference value, or {@code null} if not set
     */
    public String getPluginVariableFromConfigXml(String name) {
        try {
            return preferences.getString(name, null);
        } catch (Exception e) {
            Log.e(TAG, "Error getting " + name + " from config.xml", e);
            return null;
        }
    }

    /**
     * Persists a boolean preference to SharedPreferences.
     *
     * <p>Static for the reason given at {@link #getPreference(String)}.
     *
     * @param name  the preference key
     * @param value the boolean value to store
     */
    public static void setPreference(String name, boolean value) {
        SharedPreferences settings = applicationContext.getSharedPreferences(SETTINGS_NAME, MODE_PRIVATE);
        SharedPreferences.Editor editor = settings.edit();
        editor.putBoolean(name, value);
        editor.apply();
    }

    /**
     * Reads a boolean preference from SharedPreferences.
     *
     * <p>Falls back to reading the value from the Android manifest metadata if
     * the preference has not been explicitly set. Returns {@code false} if
     * neither source has a value.
     *
     * <p>Static, and based on the application context instead of the activity, because feature
     * plugins call this as {@code FirebasexCorePlugin.getInstance().getPreference(name)} on pool
     * threads, where {@link #getInstance()} is {@code null} once the activity has been destroyed.
     * Java evaluates and discards the target of a static call, so that expression cannot throw a
     * NullPointerException. As an instance method it did: crashlytics'
     * {@code setCrashlyticsCustomKey} calls it outside its try block, which ended the process.
     *
     * @param name the preference key
     * @return the boolean value
     */
    public static boolean getPreference(String name) {
        boolean result;
        try {
            SharedPreferences settings = applicationContext.getSharedPreferences(SETTINGS_NAME, MODE_PRIVATE);
            result = settings.getBoolean(name, false);
        } catch (Exception e) {
            try {
                result = getMetaDataFromManifest(name);
            } catch (Exception e2) {
                result = false;
            }
        }
        return result;
    }

    /**
     * Converts a boolean to an integer suitable for Cordova plugin results.
     *
     * @param result the boolean value
     * @return 1 for {@code true}, 0 for {@code false}
     */
    public int conformBooleanForPluginResult(boolean result) {
        return result ? 1 : 0;
    }

    /**
     * Qualifies a permission name with the {@code android.permission.} prefix if needed.
     *
     * @param permission the permission name (e.g., "CAMERA" or "android.permission.CAMERA")
     * @return the fully qualified permission string
     */
    protected String qualifyPermission(String permission) {
        if (permission.startsWith("android.permission.")) {
            return permission;
        }
        return "android.permission." + permission;
    }

    /**
     * Checks if a runtime permission has been granted.
     *
     * <p>Uses reflection to support older Cordova versions that may not have
     * the {@code hasPermission} method.
     *
     * @param permission the permission to check
     * @return {@code true} if the permission is granted
     * @throws Exception if an error occurs during the check
     */
    protected boolean hasRuntimePermission(String permission) throws Exception {
        boolean hasRuntimePermission = true;
        String qualifiedPermission = qualifyPermission(permission);
        try {
            Method method = cordova.getClass().getMethod("hasPermission", qualifiedPermission.getClass());
            Boolean bool = (Boolean) method.invoke(cordova, qualifiedPermission);
            hasRuntimePermission = bool.booleanValue();
        } catch (NoSuchMethodException e) {
            Log.w(TAG, "Cordova does not support runtime permissions, defaulting to GRANTED for " + permission);
        }
        return hasRuntimePermission;
    }

    /**
     * Requests runtime permissions from the user.
     *
     * <p>Uses reflection to support older Cordova versions.
     *
     * @param plugin      the plugin requesting the permissions
     * @param requestCode the request code for the permission callback
     * @param permissions the permissions to request
     * @throws Exception if the method is not available in the Cordova interface
     */
    protected void requestPermissions(CordovaPlugin plugin, int requestCode, String[] permissions) throws Exception {
        try {
            Method method = cordova.getClass().getMethod("requestPermissions",
                CordovaPlugin.class, int.class, String[].class);
            method.invoke(cordova, plugin, requestCode, permissions);
        } catch (NoSuchMethodException e) {
            throw new Exception("requestPermissions() method not found in CordovaInterface");
        }
    }

    /**
     * Retrieves a string resource by name from the application's resources.
     *
     * @param name the resource name (without the {@code R.string.} prefix)
     * @return the string resource value
     */
    public String getStringResource(String name) {
        return applicationContext.getString(
            applicationContext.getResources().getIdentifier(
                name, "string", applicationContext.getPackageName()
            )
        );
    }
}
