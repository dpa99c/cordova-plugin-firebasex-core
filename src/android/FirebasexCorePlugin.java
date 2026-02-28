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

public class FirebasexCorePlugin extends CordovaPlugin {

    protected static FirebasexCorePlugin instance = null;
    protected static Context applicationContext = null;
    private static Activity cordovaActivity = null;
    private static CordovaInterface cordovaInterface = null;
    private static boolean pluginInitialized = false;
    private static boolean onPageFinished = false;
    private static boolean inBackground = true;
    private static ArrayList<String> pendingGlobalJS = null;

    protected static final String TAG = "FirebasexCore";
    protected static final String JS_GLOBAL_NAMESPACE = "FirebasexCore.";
    protected static final String SETTINGS_NAME = "firebasex_settings";

    public static FirebasexCorePlugin getInstance() {
        return instance;
    }

    public static boolean isApplicationInBackground() {
        return inBackground;
    }

    public static boolean isPageFinished() {
        return onPageFinished;
    }

    public static Context getApplicationContext() {
        return applicationContext;
    }

    public static Activity getCordovaActivity() {
        return cordovaActivity;
    }

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

    @Override
    public void onPause(boolean multitasking) {
        inBackground = true;
        FirebasexEventBus.broadcast(applicationContext, "FirebasexAppDidEnterBackground", null);
    }

    @Override
    public void onResume(boolean multitasking) {
        inBackground = false;
        FirebasexEventBus.broadcast(applicationContext, "FirebasexAppDidBecomeActive", null);
    }

    @Override
    public void onReset() {
        // Subclasses or other plugins can override
    }

    @Override
    public void onDestroy() {
        instance = null;
        cordovaActivity = null;
        cordovaInterface = null;
        applicationContext = null;
        onReset();
        super.onDestroy();
    }

    // Installations API

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

    private void getInstallationToken(final CallbackContext callbackContext) {
        cordova.getThreadPool().execute(new Runnable() {
            public void run() {
                try {
                    FirebaseInstallations.getInstance().getToken(false)
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

    // Utility methods shared across plugins

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

    private void doExecuteGlobalJavascript(final String jsString) {
        if (cordovaActivity == null) return;
        cordovaActivity.runOnUiThread(new Runnable() {
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

    public static void handleExceptionWithContext(Exception e, CallbackContext context) {
        String msg = e.toString();
        Log.e(TAG, msg);
        logExceptionToCrashlyticsIfAvailable(e);
        context.error(msg);
    }

    public static void handleExceptionWithoutContext(Exception e) {
        String msg = e.toString();
        Log.e(TAG, msg);
        logExceptionToCrashlyticsIfAvailable(e);
        if (instance != null) {
            instance.logErrorToWebview(msg);
        }
    }

    private static void logExceptionToCrashlyticsIfAvailable(Exception e) {
        try {
            Class<?> crashlyticsClass = Class.forName("com.google.firebase.crashlytics.FirebaseCrashlytics");
            Object crashlytics = crashlyticsClass.getMethod("getInstance").invoke(null);
            crashlyticsClass.getMethod("recordException", Throwable.class).invoke(crashlytics, e);
        } catch (Exception ignored) {
            // Crashlytics not available
        }
    }

    public void logErrorToWebview(String msg) {
        Log.e(TAG, msg);
        executeGlobalJavascript("console.error(\"" + TAG + "[native]: " + escapeDoubleQuotes(msg) + "\")");
    }

    private String escapeDoubleQuotes(String string) {
        String escapedString = string.replace("\"", "\\\"");
        escapedString = escapedString.replace("%22", "\\%22");
        return escapedString;
    }

    public void sendPluginResultAndKeepCallback(String result, CallbackContext callbackContext) {
        PluginResult pluginresult = new PluginResult(PluginResult.Status.OK, result);
        sendPluginResultAndKeepCallback(pluginresult, callbackContext);
    }

    public void sendPluginResultAndKeepCallback(boolean result, CallbackContext callbackContext) {
        PluginResult pluginresult = new PluginResult(PluginResult.Status.OK, result);
        sendPluginResultAndKeepCallback(pluginresult, callbackContext);
    }

    public void sendPluginResultAndKeepCallback(int result, CallbackContext callbackContext) {
        PluginResult pluginresult = new PluginResult(PluginResult.Status.OK, result);
        sendPluginResultAndKeepCallback(pluginresult, callbackContext);
    }

    public void sendPluginResultAndKeepCallback(JSONArray result, CallbackContext callbackContext) {
        PluginResult pluginresult = new PluginResult(PluginResult.Status.OK, result);
        sendPluginResultAndKeepCallback(pluginresult, callbackContext);
    }

    public void sendPluginResultAndKeepCallback(JSONObject result, CallbackContext callbackContext) {
        PluginResult pluginresult = new PluginResult(PluginResult.Status.OK, result);
        sendPluginResultAndKeepCallback(pluginresult, callbackContext);
    }

    public void sendEmptyPluginResultAndKeepCallback(CallbackContext callbackContext) {
        PluginResult pluginresult = new PluginResult(PluginResult.Status.NO_RESULT);
        pluginresult.setKeepCallback(true);
        callbackContext.sendPluginResult(pluginresult);
    }

    public void sendPluginResultAndKeepCallback(PluginResult pluginresult, CallbackContext callbackContext) {
        pluginresult.setKeepCallback(true);
        callbackContext.sendPluginResult(pluginresult);
    }

    // SharedPreferences helpers

    public boolean getMetaDataFromManifest(String name) throws Exception {
        return applicationContext.getPackageManager()
            .getApplicationInfo(applicationContext.getPackageName(), PackageManager.GET_META_DATA)
            .metaData.getBoolean(name);
    }

    public String getPluginVariableFromConfigXml(String name) {
        try {
            return preferences.getString(name, null);
        } catch (Exception e) {
            Log.e(TAG, "Error getting " + name + " from config.xml", e);
            return null;
        }
    }

    public void setPreference(String name, boolean value) {
        SharedPreferences settings = cordovaActivity.getSharedPreferences(SETTINGS_NAME, MODE_PRIVATE);
        SharedPreferences.Editor editor = settings.edit();
        editor.putBoolean(name, value);
        editor.apply();
    }

    public boolean getPreference(String name) {
        boolean result;
        try {
            SharedPreferences settings = cordovaActivity.getSharedPreferences(SETTINGS_NAME, MODE_PRIVATE);
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

    public int conformBooleanForPluginResult(boolean result) {
        return result ? 1 : 0;
    }

    protected String qualifyPermission(String permission) {
        if (permission.startsWith("android.permission.")) {
            return permission;
        }
        return "android.permission." + permission;
    }

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

    protected void requestPermissions(CordovaPlugin plugin, int requestCode, String[] permissions) throws Exception {
        try {
            Method method = cordova.getClass().getMethod("requestPermissions",
                CordovaPlugin.class, int.class, String[].class);
            method.invoke(cordova, plugin, requestCode, permissions);
        } catch (NoSuchMethodException e) {
            throw new Exception("requestPermissions() method not found in CordovaInterface");
        }
    }

    public String getStringResource(String name) {
        return applicationContext.getString(
            applicationContext.getResources().getIdentifier(
                name, "string", applicationContext.getPackageName()
            )
        );
    }
}
