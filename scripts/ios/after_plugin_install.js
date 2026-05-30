/**
 * @file after_plugin_install.js
 * @brief Hook script that runs after the core plugin is installed on iOS.
 *
 * 1. Ensures the Xcode project has the correct LD_RUNPATH_SEARCH_PATHS build
 *    settings so that embedded frameworks can be found at runtime.
 *
 * 2. Updates the Firebase dependency version token in Package.swift based on the
 *    IOS_FIREBASE_SDK_VERSION plugin variable.
 *
 * 3. If a Podfile is present for a CocoaPods fallback install, keeps the Podfile
 *    versions in sync as well.
 *
 * Plugin variables are resolved using a 4-layer override strategy:
 * 1. Defaults from plugin.xml preferences (via hook context).
 * 2. Overrides from `config.xml` `<plugin><variable>` elements (wrapper and own plugin ID).
 * 3. Overrides from `package.json` `cordova.plugins` entries (wrapper and own plugin ID).
 * 4. CLI variables passed at install time (highest priority).
 */
var fs = require("fs");
var path = require("path");
var helper = require("./helper");

/** @constant {string} The plugin identifier. */
var PLUGIN_ID = "cordova-plugin-firebasex-core";
/** @constant {string} The wrapper meta-plugin identifier used as a fallback source for plugin variables. */
var WRAPPER_PLUGIN_ID = "cordova-plugin-firebasex";

/**
 * Resolves plugin variables using the 4-layer override strategy.
 *
 * @param {object} context - The Cordova hook context.
 * @returns {Object} Resolved plugin variable key/value pairs.
 */
function resolvePluginVariables(context) {
    var pluginVariables = {};

    // 1. Defaults from plugin.xml preferences
    var plugin = context.opts.plugin;
    if (plugin && plugin.pluginInfo && plugin.pluginInfo._et && plugin.pluginInfo._et._root && plugin.pluginInfo._et._root._children) {
        plugin.pluginInfo._et._root._children.forEach(function(child) {
            if (child.tag === "preference") {
                pluginVariables[child.attrib.name] = child.attrib.default;
            }
        });
    }

    // 2. Overrides from config.xml
    try {
        var configXmlPath = path.join(context.opts.projectRoot, "config.xml");
        if (fs.existsSync(configXmlPath)) {
            var configXml = fs.readFileSync(configXmlPath, "utf-8");
            [WRAPPER_PLUGIN_ID, PLUGIN_ID].forEach(function(pluginId) {
                var pluginRegex = new RegExp('<plugin[^>]+name="' + pluginId + '"[^>]*>(.*?)</plugin>', "s");
                var pluginMatch = configXml.match(pluginRegex);
                if (pluginMatch) {
                    var varRegex = /<variable\s+name="([^"]+)"\s+value="([^"]+)"\s*\/>/g;
                    var varMatch;
                    while ((varMatch = varRegex.exec(pluginMatch[1])) !== null) {
                        pluginVariables[varMatch[1]] = varMatch[2];
                    }
                }
            });
        } else {
            console.warn("[FirebasexCore] config.xml not found at " + configXmlPath + ". Cannot read plugin variables from config.xml.");
        }
    } catch (e) {
        console.warn("[FirebasexCore] Could not read config.xml for plugin variables: " + e.message);
    }

    // 3. Overrides from package.json
    try {
        var packageJsonPath = path.join(context.opts.projectRoot, "package.json");
        if (fs.existsSync(packageJsonPath)) {
            var packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
            if (packageJson.cordova && packageJson.cordova.plugins) {
                [WRAPPER_PLUGIN_ID, PLUGIN_ID].forEach(function(pluginId) {
                    if (packageJson.cordova.plugins[pluginId]) {
                        var pluginVars = packageJson.cordova.plugins[pluginId];
                        for (var key in pluginVars) {
                            pluginVariables[key] = pluginVars[key];
                        }
                    }
                });
            }
        } else {
            console.warn("[FirebasexCore] package.json not found at " + packageJsonPath + ". Cannot read plugin variables from package.json.");
         }
    } catch (e) {
        console.warn("[FirebasexCore] Could not read package.json for plugin variables: " + e.message);
    }

    // 4. CLI variable overrides (highest priority)
    if (context.opts && context.opts.cli_variables) {
        Object.keys(context.opts.cli_variables).forEach(function(key) {
            pluginVariables[key] = context.opts.cli_variables[key];
        });
    }

    return pluginVariables;
}

/**
 * Updates one or more Firebase pod versions in the Podfile.
 * Matches pod lines of the form: pod 'PodName', 'X.Y.Z'
 *
 * @param {string} podfilePath - Absolute path to the Podfile.
 * @param {string[]} podNames - Array of pod names to update.
 * @param {string} newVersion - The new version string to set.
 */
function updateFirebasePodVersions(podfilePath, podNames, newVersion) {
    if (!fs.existsSync(podfilePath)) {
        console.warn("[FirebasexCore] Podfile not found at " + podfilePath + ". Cannot update Firebase pod versions.");
        return;
    }
    try {
        var podfileContents = fs.readFileSync(podfilePath, "utf-8");
        var versionRegex = /\d+\.\d+\.\d+[^'"]*/;
        var modified = false;
        podNames.forEach(function(podName) {
            var escapedName = podName.replace(/\//g, "\\/");
            var podRegex = new RegExp("pod '" + escapedName + "', '(\\d+\\.\\d+\\.\\d+[^'\"]*)'", "g");
            var matches = podfileContents.match(podRegex);
            if (matches) {
                matches.forEach(function(match) {
                    var currentVersion = match.match(versionRegex)[0];
                    if (currentVersion !== newVersion) {
                        podfileContents = podfileContents.replace(match, match.replace(currentVersion, newVersion));
                        modified = true;
                    }
                });
            }
        });
        if (modified) {
            fs.writeFileSync(podfilePath, podfileContents);
            console.log("[FirebasexCore] Firebase SDK version set to v" + newVersion + " in Podfile");
        }
    } catch (e) {
        console.warn("[FirebasexCore] Error updating Firebase pod versions: " + e.message);
    }
}

/**
 * Cordova hook entry point.
 * Ensures runpath search settings, then updates Firebase pod versions in the Podfile.
 *
 * @param {object} context - The Cordova hook context.
 */
module.exports = function(context) {
    var xcodeProjectPath = helper.getXcodeProjectPath();
    helper.ensureRunpathSearchPath(context, xcodeProjectPath);

    var pluginVariables = resolvePluginVariables(context);
    var iosPlatformPath = path.join(context.opts.projectRoot, "platforms", "ios");
    var podfilePath = path.join(iosPlatformPath, "Podfile");
    var useSwiftPackageManager = fs.existsSync(path.join(iosPlatformPath, "App"));

    if (useSwiftPackageManager) {
        helper.applyPluginVarsToPackageManifest(pluginVariables, PLUGIN_ID);
        return;
    }

    if (pluginVariables["IOS_FIREBASE_SDK_VERSION"] && fs.existsSync(podfilePath)) {
        updateFirebasePodVersions(podfilePath, ["FirebaseCore", "FirebaseCoreExtension", "FirebaseInstallations"], pluginVariables["IOS_FIREBASE_SDK_VERSION"]);
        helper.applyPodsPostInstall(pluginVariables, { podFile: podfilePath });
    }
};
