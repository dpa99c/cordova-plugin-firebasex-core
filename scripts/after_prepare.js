#!/usr/bin/env node

/**
 * @file after_prepare.js
 * @brief Cordova "after_prepare" hook for the cordova-plugin-firebasex-core plugin.
 *
 * Runs after each `cordova prepare` to configure Firebase for both Android and iOS platforms:
 *
 * **Android:**
 * - Copies `google-services.json` to the correct platform location.
 * - Validates the file contains a Web Client ID (client_type: 3) required by Credential Manager.
 * - Adds the `tools` XML namespace to `AndroidManifest.xml` if missing.
 *
 * **iOS:**
 * - Copies `GoogleService-Info.plist` to the correct platform location.
 * - Validates the plist contains a `REVERSED_CLIENT_ID` entry required for Google Sign-In.
 * - Ensures correct `LD_RUNPATH_SEARCH_PATHS` in the Xcode project.
 * - Applies a `post_install` block to the Podfile (debug format / deployment target / code signing).
 * - Writes plugin variable values into the app and Google plists.
 * - Adds the encoded Google App ID as a URL scheme.
 * - Overrides Firebase SDK pod versions if `IOS_FIREBASE_SDK_VERSION` is set.
 * - Runs `pod install --repo-update` if the Podfile was modified.
 *
 * @module scripts/after_prepare
 */
'use strict';

var fs = require('fs');
var path = require("path");
var execSync = require('child_process').execSync;
var utilities = require("./lib/utilities");

/** @type {string} The application name derived from config.xml. */
var appName;

/** @type {string} The path to the iOS app subdirectory, which may be `platforms/ios/App` for cordova-ios 8+ or `platforms/ios/{appName}` for older versions */
var appSubDirPath;

/** @type {Object} Resolved plugin variable key/value pairs. */
var pluginVariables = {};

/** @constant {string} Root directory of the iOS platform. */
var IOS_DIR = 'platforms/ios';
/** @constant {string} Root directory of the Android platform. */
var ANDROID_DIR = 'platforms/android';
/** @type {string} The plugin ID extracted from plugin.xml. */
var PLUGIN_ID;

/**
 * @type {Object} Platform-specific configuration built by {@link setupEnv}.
 * Contains paths for key files, plist files, Podfile, colors.xml, and manifest.
 */
var PLATFORM;

/**
 * Initialises the {@link PLATFORM} configuration object with platform-specific paths
 * derived from the application name and plugin ID.
 *
 * Must be called after {@link utilities.setContext} so that `getAppName()` and
 * `getPluginId()` can resolve their values.
 * 
 * @param {object} context - The Cordova hook context.
 */
var setupEnv = function (context) {
    appName = utilities.getAppName();
    appSubDirPath = utilities.getAppSubDirPath(path.join(context.opts.projectRoot, IOS_DIR));
    PLUGIN_ID = utilities.getPluginId();
    PLATFORM = {
        IOS: {
            platformDir: IOS_DIR,
            dest: path.join(appSubDirPath, 'Resources/GoogleService-Info.plist'),
            src: [
                'GoogleService-Info.plist',
                path.join(IOS_DIR, 'www/GoogleService-Info.plist'),
                'www/GoogleService-Info.plist'
            ],
            appPlist: path.join(appSubDirPath, appName + '-Info.plist'),
            entitlementsDebugPlist: path.join(appSubDirPath, 'Entitlements-Debug.plist'),
            entitlementsReleasePlist: path.join(appSubDirPath, 'Entitlements-Release.plist'),
            podFile: path.join(IOS_DIR, 'Podfile')
        },
        ANDROID: {
            platformDir: ANDROID_DIR,
            dest: ANDROID_DIR + '/app/google-services.json',
            src: [
                'google-services.json',
                ANDROID_DIR + '/assets/www/google-services.json',
                'www/google-services.json',
                ANDROID_DIR + '/app/src/main/google-services.json'
            ],
            manifestXml: ANDROID_DIR + '/app/src/main/AndroidManifest.xml',
        }
    };
};

/**
 * Cordova hook entry point.
 *
 * Sets up the environment, resolves plugin variables, then runs platform-specific
 * preparation for each platform present in the build.
 *
 * @param {object} context - The Cordova hook context.
 */
module.exports = function (context) {
    var platforms = context.opts.platforms;
    utilities.setContext(context);
    setupEnv(context);

    pluginVariables = utilities.parsePluginVariables();

    // Allow override of config file paths via plugin variables
    if (pluginVariables.ANDROID_FIREBASE_CONFIG_FILEPATH) PLATFORM.ANDROID.src = [pluginVariables.ANDROID_FIREBASE_CONFIG_FILEPATH];
    if (pluginVariables.IOS_FIREBASE_CONFIG_FILEPATH) PLATFORM.IOS.src = [pluginVariables.IOS_FIREBASE_CONFIG_FILEPATH];

    // Copy key files to their platform specific folders
    if (platforms.indexOf('android') !== -1 && utilities.directoryExists(ANDROID_DIR)) {
        utilities.log('Preparing Firebase on Android');
        utilities.copyKey(PLATFORM.ANDROID);

        // Validate google-services.json contains a Web Client ID (client_type: 3)
        // which is required for Android Credential Manager authentication.
        try {
            var jsonContent = fs.readFileSync(path.resolve(PLATFORM.ANDROID.dest)).toString();
            var json = JSON.parse(jsonContent);
            var hasWebClientId = false;
            if (json.client) {
                json.client.forEach(function (c) {
                    if (c.oauth_client) {
                        c.oauth_client.forEach(function (oc) {
                            if (oc.client_type === 3) {
                                hasWebClientId = true;
                            }
                        });
                    }
                });
            }
            if (!hasWebClientId) {
                utilities.warn("google-services.json does not contain a Web Client ID (client_type: 3). Android Credential Manager requires a Web Client ID.");
            }
        } catch (e) {
            utilities.warn("Failed to validate google-services.json: " + e.message);
        }

        // Ensure the `tools` XML namespace is declared in AndroidManifest.xml.
        // Required for tools:replace and other manifest merge directives.
        if (fs.existsSync(path.resolve(PLATFORM.ANDROID.manifestXml))) {
            const manifestContents = fs.readFileSync(path.resolve(PLATFORM.ANDROID.manifestXml)).toString();
            if (!manifestContents.match('xmlns:tools="http://schemas.android.com/tools"')) {
                const manifestWithTools = manifestContents.replace(/<manifest/g, '<manifest xmlns:tools="http://schemas.android.com/tools"');
                fs.writeFileSync(path.resolve(PLATFORM.ANDROID.manifestXml), manifestWithTools);
                utilities.log('Added tools namespace to AndroidManifest.xml');
            }
        }
    }

    if (platforms.indexOf('ios') !== -1 && utilities.directoryExists(IOS_DIR)) {
        utilities.log('Preparing Firebase on iOS');
        utilities.copyKey(PLATFORM.IOS);
        var useSwiftPackageManager = utilities.isCordovaIOS8Plus(path.join(context.opts.projectRoot, IOS_DIR));

        // Validate GoogleService-Info.plist contains REVERSED_CLIENT_ID,
        // which is required for Google Sign-In on iOS.
        try {
            var plistPath = path.resolve(PLATFORM.IOS.dest);
            if(!fs.existsSync(plistPath)){
                utilities.warn("GoogleService-Info.plist not found at " + plistPath + ". Aborting plist validation.");
                return;
            }
            var plistContent = fs.readFileSync(plistPath).toString();
            if (plistContent.indexOf("REVERSED_CLIENT_ID") === -1) {
                utilities.warn("GoogleService-Info.plist does not contain REVERSED_CLIENT_ID. Google Sign-In on iOS requires this.");
            }
        } catch (e) {
            utilities.warn("Failed to validate GoogleService-Info.plist: " + e.message);
        }

        var helper = require("./ios/helper");
        var xcodeProjectPath = helper.getXcodeProjectPath();
        var packageManifestModified = false;
        var podFileModified = false;
        helper.ensureRunpathSearchPath(context, xcodeProjectPath);
        if (useSwiftPackageManager) {
            packageManifestModified = helper.applyPluginVarsToPackageManifest(pluginVariables, PLUGIN_ID);
        }
        helper.applyPluginVarsToPlists(pluginVariables, PLATFORM.IOS);
        helper.ensureEncodedAppIdInUrlSchemes(PLATFORM.IOS);

        if (!useSwiftPackageManager && fs.existsSync(path.resolve(PLATFORM.IOS.podFile))) {
            podFileModified = helper.applyPodsPostInstall(pluginVariables, PLATFORM.IOS);
            podFileModified = helper.applyPluginVarsToPodfile(pluginVariables, PLATFORM.IOS) || podFileModified;
        }

        if (podFileModified) {
            utilities.log('Updating installed Pods');
            execSync('pod install --repo-update', {
                cwd: path.resolve(PLATFORM.IOS.platformDir),
                encoding: 'utf8'
            });
        }

        if (packageManifestModified) {
            utilities.log('Updated Swift package manifest for iOS Firebase dependencies');
        }
    }
};
