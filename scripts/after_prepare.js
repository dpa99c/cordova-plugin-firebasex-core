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
 * - Copies/creates `colors.xml` with the notification accent colour from plugin variables.
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
 */
var setupEnv = function () {
    appName = utilities.getAppName();
    PLUGIN_ID = utilities.getPluginId();
    PLATFORM = {
        IOS: {
            platformDir: IOS_DIR,
            dest: IOS_DIR + '/' + appName + '/Resources/GoogleService-Info.plist',
            src: [
                'GoogleService-Info.plist',
                IOS_DIR + '/www/GoogleService-Info.plist',
                'www/GoogleService-Info.plist'
            ],
            appPlist: IOS_DIR + '/' + appName + '/' + appName + '-Info.plist',
            entitlementsDebugPlist: IOS_DIR + '/' + appName + '/Entitlements-Debug.plist',
            entitlementsReleasePlist: IOS_DIR + '/' + appName + '/Entitlements-Release.plist',
            podFile: IOS_DIR + '/Podfile'
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
            colorsXml: {
                src: './plugins/' + PLUGIN_ID + '/src/android/colors.xml',
                target: ANDROID_DIR + '/app/src/main/res/values/colors.xml'
            },
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
    setupEnv();

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

        // Copy colors.xml from the plugin source if it doesn't already exist in the platform.
        // This file provides the accent colour used in notification icons.
        if (!fs.existsSync(path.resolve(PLATFORM.ANDROID.colorsXml.target))) {
            var colorsXmlSrc = path.resolve(PLATFORM.ANDROID.colorsXml.src);
            if (fs.existsSync(colorsXmlSrc)) {
                fs.copyFileSync(colorsXmlSrc, path.resolve(PLATFORM.ANDROID.colorsXml.target));
            }
        }

        // Parse colors.xml and update/add the 'accent' colour entry from plugin variables.
        if (fs.existsSync(path.resolve(PLATFORM.ANDROID.colorsXml.target))) {
            const $colorsXml = utilities.parseXmlFileToJson(PLATFORM.ANDROID.colorsXml.target, { compact: true });
            var accentColor = pluginVariables.ANDROID_ICON_ACCENT,
                $resources = $colorsXml.resources,
                existingAccent = false,
                writeChanges = false;

            if ($resources.color) {
                var $colors = $resources.color.length ? $resources.color : [$resources.color];
                $colors.forEach(function ($color) {
                    if ($color._attributes.name === 'accent') {
                        existingAccent = true;
                        if ($color._text !== accentColor) {
                            $color._text = accentColor;
                            writeChanges = true;
                        }
                    }
                });
            } else {
                $resources.color = {};
            }

            if (!existingAccent) {
                var $accentColor = {
                    _attributes: { name: 'accent' },
                    _text: accentColor
                };
                if ($resources.color && Object.keys($resources.color).length) {
                    if (typeof $resources.color.length === 'undefined') {
                        $resources.color = [$resources.color];
                    }
                    $resources.color.push($accentColor);
                } else {
                    $resources.color = $accentColor;
                }
                writeChanges = true;
            }

            if (writeChanges) {
                utilities.writeJsonToXmlFile($colorsXml, PLATFORM.ANDROID.colorsXml.target);
                utilities.log('Updated colors.xml with accent color');
            }
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

        // Validate GoogleService-Info.plist contains REVERSED_CLIENT_ID,
        // which is required for Google Sign-In on iOS.
        try {
            var plistContent = fs.readFileSync(path.resolve(PLATFORM.IOS.dest)).toString();
            if (plistContent.indexOf("REVERSED_CLIENT_ID") === -1) {
                utilities.warn("GoogleService-Info.plist does not contain REVERSED_CLIENT_ID. Google Sign-In on iOS requires this.");
            }
        } catch (e) {
            utilities.warn("Failed to validate GoogleService-Info.plist: " + e.message);
        }

        var helper = require("./ios/helper");
        var xcodeProjectPath = helper.getXcodeProjectPath();
        var podFileModified = false;
        helper.ensureRunpathSearchPath(context, xcodeProjectPath);
        podFileModified = helper.applyPodsPostInstall(pluginVariables, PLATFORM.IOS);
        helper.applyPluginVarsToPlists(pluginVariables, PLATFORM.IOS);
        helper.ensureEncodedAppIdInUrlSchemes(PLATFORM.IOS);
        podFileModified = helper.applyPluginVarsToPodfile(pluginVariables, PLATFORM.IOS) || podFileModified;

        if (podFileModified) {
            utilities.log('Updating installed Pods');
            execSync('pod install --repo-update', {
                cwd: path.resolve(PLATFORM.IOS.platformDir),
                encoding: 'utf8'
            });
        }
    }
};
