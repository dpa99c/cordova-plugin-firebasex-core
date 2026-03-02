/**
 * @file helper.js
 * @brief iOS-specific build helpers for the cordova-plugin-firebasex-core plugin.
 *
 * Provides utilities for modifying the Xcode project, Podfile, and plist files
 * during Cordova build hooks. Functions in this module handle:
 * - Locating the Xcode project path (supports both cordova-ios <8 and >=8 layouts).
 * - Ensuring `LD_RUNPATH_SEARCH_PATHS` includes `@executable_path/Frameworks`.
 * - Adding a `post_install` block to the Podfile for build configuration.
 * - Writing plugin variable values into `GoogleService-Info.plist` and `Info.plist`.
 * - Overriding Firebase pod versions via `IOS_FIREBASE_SDK_VERSION`.
 * - Adding the encoded Google App ID as a URL scheme.
 *
 * @module scripts/ios/helper
 */
var fs = require("fs");
var path = require("path");
var utilities = require("../lib/utilities");
var xcode = require("xcode");
var plist = require('plist');

/** @constant {RegExp} Matches semantic version strings (e.g., "11.0.0"). */
var versionRegex = /\d+\.\d+\.\d+[^'"]*/, 
    /** @constant {RegExp} Matches Firebase pod declarations with name and version in Podfile. */
    firebasePodRegex = /pod 'Firebase([^']+)', '(\d+\.\d+\.\d+[^'"]*)'[^\n]*/g,
    /** @constant {RegExp} Extracts the iOS deployment target version from the Podfile `platform` directive. */
    iosDeploymentTargetPodRegEx = /platform :ios, '(\d+\.\d+\.?\d*)'/;

/**
 * Ensures a URL scheme entry exists in an app's Info.plist `CFBundleURLTypes` array.
 * If the scheme already exists, no changes are made. Otherwise it is appended under
 * an "Editor" role entry, creating one if necessary.
 *
 * @param {string} urlScheme - The URL scheme to add (e.g., "com.googleusercontent.apps.xxx").
 * @param {Object} appPlist - Parsed plist object representing the app's Info.plist.
 * @returns {{plist: Object, modified: boolean}} The (possibly updated) plist and whether it was changed.
 */
function ensureUrlSchemeInPlist(urlScheme, appPlist){
    var appPlistModified = false;
    if(!appPlist['CFBundleURLTypes']) appPlist['CFBundleURLTypes'] = [];
    var entry, entryIndex, i, j, alreadyExists = false;

    for(i=0; i<appPlist['CFBundleURLTypes'].length; i++){
        var thisEntry = appPlist['CFBundleURLTypes'][i];
        if(thisEntry['CFBundleURLSchemes']){
            for(j=0; j<thisEntry['CFBundleURLSchemes'].length; j++){
                if(thisEntry['CFBundleURLSchemes'][j] === urlScheme){
                    alreadyExists = true;
                    break;
                }
            }
        }
        if(thisEntry['CFBundleTypeRole'] === 'Editor'){
            entry = thisEntry;
            entryIndex = i;
        }
    }
    if(!alreadyExists){
        if(!entry) entry = {};
        if(!entry['CFBundleTypeRole']) entry['CFBundleTypeRole'] = 'Editor';
        if(!entry['CFBundleURLSchemes']) entry['CFBundleURLSchemes'] = [];
        entry['CFBundleURLSchemes'].push(urlScheme)
        if(typeof entryIndex === "undefined") entryIndex = i;
        appPlist['CFBundleURLTypes'][entryIndex] = entry;
        appPlistModified = true;
        utilities.log('Added URL scheme "'+urlScheme+'"');
    }

    return {plist: appPlist, modified: appPlistModified}
}

module.exports = {
    /**
     * Returns the path to the Xcode project's `project.pbxproj` file.
     * Supports both the legacy layout (`<AppName>.xcodeproj`) used by cordova-ios <8
     * and the new layout (`App.xcodeproj`) used by cordova-ios >=8.
     *
     * @returns {string} Relative path to `project.pbxproj`.
     */
    getXcodeProjectPath: function () {
        var appName = utilities.getAppName();
        var oldPath = path.join("platforms", "ios", appName + ".xcodeproj", "project.pbxproj");
        var newPath = path.join("platforms", "ios", "App.xcodeproj", "project.pbxproj");
        if (fs.existsSync(newPath)) {
            return newPath;
        }
        return oldPath;
    },

    /**
     * Ensures `LD_RUNPATH_SEARCH_PATHS` contains `@executable_path/Frameworks` and
     * `$(inherited)` for both Debug and Release build configurations in the Xcode project.
     * This is required for embedded frameworks (e.g., Firebase SDKs) to be found at runtime.
     *
     * @param {object} context - The Cordova hook context.
     * @param {string} xcodeProjectPath - Path to the `project.pbxproj` file.
     */
    ensureRunpathSearchPath: function(context, xcodeProjectPath){
        /**
         * Adds or updates the `LD_RUNPATH_SEARCH_PATHS` build property for a given
         * build configuration to include `@executable_path/Frameworks` and `$(inherited)`.
         *
         * @param {object} proj - The parsed xcode project object.
         * @param {string} build - The build configuration name ("Debug" or "Release").
         */
        function addRunpathSearchBuildProperty(proj, build) {
            let LD_RUNPATH_SEARCH_PATHS = proj.getBuildProperty("LD_RUNPATH_SEARCH_PATHS", build);
            if (!Array.isArray(LD_RUNPATH_SEARCH_PATHS)) {
                LD_RUNPATH_SEARCH_PATHS = [LD_RUNPATH_SEARCH_PATHS];
            }
            LD_RUNPATH_SEARCH_PATHS.forEach(LD_RUNPATH_SEARCH_PATH => {
                if (!LD_RUNPATH_SEARCH_PATH) {
                    proj.addBuildProperty("LD_RUNPATH_SEARCH_PATHS", "\"$(inherited) @executable_path/Frameworks\"", build);
                }
                if (LD_RUNPATH_SEARCH_PATH.indexOf("@executable_path/Frameworks") == -1) {
                    var newValue = LD_RUNPATH_SEARCH_PATH.substr(0, LD_RUNPATH_SEARCH_PATH.length - 1);
                    newValue += ' @executable_path/Frameworks\"';
                    proj.updateBuildProperty("LD_RUNPATH_SEARCH_PATHS", newValue, build);
                }
                if (LD_RUNPATH_SEARCH_PATH.indexOf("$(inherited)") == -1) {
                    var newValue = LD_RUNPATH_SEARCH_PATH.substr(0, LD_RUNPATH_SEARCH_PATH.length - 1);
                    newValue += ' $(inherited)\"';
                    proj.updateBuildProperty("LD_RUNPATH_SEARCH_PATHS", newValue, build);
                }
            });
        }

        var xcodeProject = xcode.project(xcodeProjectPath);
        xcodeProject.parseSync();
        addRunpathSearchBuildProperty(xcodeProject, "Debug");
        addRunpathSearchBuildProperty(xcodeProject, "Release");
        fs.writeFileSync(path.resolve(xcodeProjectPath), xcodeProject.writeSync());
    },

    /**
     * Appends a `post_install` block to the Podfile if one does not already exist.
     * The block configures:
     * - `DEBUG_INFORMATION_FORMAT`: Set to `dwarf` if `IOS_STRIP_DEBUG` is true, otherwise `dwarf-with-dsym`.
     * - `IPHONEOS_DEPLOYMENT_TARGET`: Matched to the platform deployment target in the Podfile.
     * - `CODE_SIGNING_ALLOWED`: Set to `NO` for resource bundle targets (required by Xcode 14+).
     *
     * @param {Object} pluginVariables - Resolved plugin variable key/value pairs.
     * @param {Object} iosPlatform - The iOS platform configuration from {@link PLATFORM}.
     * @returns {boolean} `true` if the Podfile was modified.
     */
    applyPodsPostInstall: function(pluginVariables, iosPlatform){
        var podFileModified = false,
            podFilePath = path.resolve(iosPlatform.podFile);

        if(!fs.existsSync(podFilePath)){
            utilities.warn('Podfile not found at ' + podFilePath);
            return false;
        }

        var podFile = fs.readFileSync(podFilePath).toString(),
            DEBUG_INFORMATION_FORMAT = pluginVariables['IOS_STRIP_DEBUG'] && pluginVariables['IOS_STRIP_DEBUG'] === 'true' ? 'dwarf' : 'dwarf-with-dsym',
            iosDeploymentTargetMatch = podFile.match(iosDeploymentTargetPodRegEx),
            IPHONEOS_DEPLOYMENT_TARGET = iosDeploymentTargetMatch ? iosDeploymentTargetMatch[1] : null;

        if(!podFile.match('post_install')){
            podFile += "\npost_install do |installer|\n" +
                "    installer.pods_project.targets.each do |target|\n" +
                "        target.build_configurations.each do |config|\n" +
                "            config.build_settings['DEBUG_INFORMATION_FORMAT'] = '" + DEBUG_INFORMATION_FORMAT + "'\n" +
                (IPHONEOS_DEPLOYMENT_TARGET ? "            config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '" + IPHONEOS_DEPLOYMENT_TARGET + "'\n" : "") +
                "            if target.respond_to?(:product_type) and target.product_type == \"com.apple.product-type.bundle\"\n" +
                "                config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'\n" +
                "            end\n" +
                "        end\n" +
                "    end\n" +
                "end\n";
            fs.writeFileSync(path.resolve(podFilePath), podFile);
            utilities.log('Applied post install block to Podfile');
            podFileModified = true;
        }
        return podFileModified;
    },

    /**
     * Writes plugin variable values from the Cordova configuration into the iOS plist files.
     * Currently handles:
     * - `IOS_SHOULD_ESTABLISH_DIRECT_CHANNEL`: Sets `shouldEstablishDirectChannel` in Info.plist
     *   to enable a direct FCM channel (bypassing APNs for data messages while the app is in foreground).
     *
     * @param {Object} pluginVariables - Resolved plugin variable key/value pairs.
     * @param {Object} iosPlatform - The iOS platform configuration from {@link PLATFORM}.
     */
    applyPluginVarsToPlists: function(pluginVariables, iosPlatform){
        var googlePlistPath = path.resolve(iosPlatform.dest);
        if(!fs.existsSync(googlePlistPath)){
            utilities.warn('Google plist not found at ' + googlePlistPath);
            return;
        }

        var appPlistPath = path.resolve(iosPlatform.appPlist);
        if(!fs.existsSync(appPlistPath)){
            utilities.warn('App plist not found at ' + appPlistPath);
            return;
        }

        var entitlementsDebugPlistPath = path.resolve(iosPlatform.entitlementsDebugPlist);
        if(!fs.existsSync(entitlementsDebugPlistPath)){
            utilities.warn('Entitlements debug plist not found at ' + entitlementsDebugPlistPath);
            return;
        }

        var entitlementsReleasePlistPath = path.resolve(iosPlatform.entitlementsReleasePlist);
        if(!fs.existsSync(entitlementsReleasePlistPath)){
            utilities.warn('Entitlements release plist not found at ' + entitlementsReleasePlistPath);
            return;
        }

        var googlePlist = plist.parse(fs.readFileSync(googlePlistPath, 'utf8')),
            appPlist = plist.parse(fs.readFileSync(appPlistPath, 'utf8')),
            googlePlistModified = false,
            appPlistModified = false;

        if(typeof pluginVariables['IOS_SHOULD_ESTABLISH_DIRECT_CHANNEL'] !== 'undefined'){
            appPlist["shouldEstablishDirectChannel"] = (pluginVariables['IOS_SHOULD_ESTABLISH_DIRECT_CHANNEL'] === "true");
            appPlistModified = true;
        }

        if(googlePlistModified) fs.writeFileSync(path.resolve(iosPlatform.dest), plist.build(googlePlist));
        if(appPlistModified) fs.writeFileSync(path.resolve(iosPlatform.appPlist), plist.build(appPlist));
    },

    /**
     * Overrides Firebase pod versions in the Podfile when the `IOS_FIREBASE_SDK_VERSION`
     * plugin variable is set. Finds all `pod 'Firebase...'` entries and replaces their
     * version strings with the specified version.
     *
     * @param {Object} pluginVariables - Resolved plugin variable key/value pairs.
     * @param {Object} iosPlatform - The iOS platform configuration from {@link PLATFORM}.
     * @returns {boolean} `true` if the Podfile was modified.
     * @throws {Error} If `IOS_FIREBASE_SDK_VERSION` is set but is not a valid semantic version.
     */
    applyPluginVarsToPodfile: function(pluginVariables, iosPlatform){
        var podFilePath = path.resolve(iosPlatform.podFile);
        if(!fs.existsSync(podFilePath)){
            utilities.warn('Podfile not found at ' + podFilePath);
            return false;
        }

        var podFileContents = fs.readFileSync(podFilePath, 'utf8'),
            podFileModified = false;

        if(pluginVariables['IOS_FIREBASE_SDK_VERSION']){
            if(pluginVariables['IOS_FIREBASE_SDK_VERSION'].match(versionRegex)){
                var matches = podFileContents.match(firebasePodRegex);
                if(matches){
                    matches.forEach(function(match){
                        var currentVersion = match.match(versionRegex)[0];
                        if(!match.match(pluginVariables['IOS_FIREBASE_SDK_VERSION'])){
                            podFileContents = podFileContents.replace(match, match.replace(currentVersion, pluginVariables['IOS_FIREBASE_SDK_VERSION']));
                            podFileModified = true;
                        }
                    });
                }
                if(podFileModified) utilities.log("Firebase iOS SDK version set to v"+pluginVariables['IOS_FIREBASE_SDK_VERSION']+" in Podfile");
            }else{
                throw new Error("The value \""+pluginVariables['IOS_FIREBASE_SDK_VERSION']+"\" for IOS_FIREBASE_SDK_VERSION is not a valid semantic version format");
            }
        }

        if(podFileModified) {
            fs.writeFileSync(path.resolve(iosPlatform.podFile), podFileContents);
        }

        return podFileModified;
    },

    /**
     * Adds the encoded Google App ID as a URL scheme in the app's Info.plist.
     * The encoded form replaces colons with hyphens and prefixes with `app-`
     * (e.g., `1:12345:ios:abc` becomes `app-1-12345-ios-abc`).
     * This URL scheme is required by the Firebase SDK for certain authentication flows.
     *
     * @param {Object} iosPlatform - The iOS platform configuration from {@link PLATFORM}.
     */
    ensureEncodedAppIdInUrlSchemes: function(iosPlatform){
        var googlePlistPath = path.resolve(iosPlatform.dest);
        if(!fs.existsSync(googlePlistPath)){
            utilities.warn('Google plist not found at ' + googlePlistPath);
            return;
        }

        var appPlistPath = path.resolve(iosPlatform.appPlist);
        if(!fs.existsSync(appPlistPath)){
            utilities.warn('App plist not found at ' + appPlistPath);
            return;
        }

        var googlePlist = plist.parse(fs.readFileSync(googlePlistPath, 'utf8')),
            appPlist = plist.parse(fs.readFileSync(appPlistPath, 'utf8')),
            googleAppId = googlePlist["GOOGLE_APP_ID"];

        if(!googleAppId){
            utilities.warn("Google App ID not found in Google plist");
            return;
        }

        var encodedAppId = 'app-'+googleAppId.replace(/:/g,'-');
        var result = ensureUrlSchemeInPlist(encodedAppId, appPlist);
        if(result.modified){
            fs.writeFileSync(path.resolve(iosPlatform.appPlist), plist.build(result.plist));
        }
    },

    ensureUrlSchemeInPlist: ensureUrlSchemeInPlist
};
