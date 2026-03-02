/**
 * @file after_plugin_install.js
 * @brief Hook script that runs after the core plugin is installed on iOS.
 *
 * Ensures the Xcode project has the correct LD_RUNPATH_SEARCH_PATHS build
 * settings so that embedded frameworks can be found at runtime.
 */
var helper = require("./helper");

/**
 * Cordova hook entry point.
 * @param {object} context - The Cordova hook context.
 */
module.exports = function(context) {
    var xcodeProjectPath = helper.getXcodeProjectPath();
    helper.ensureRunpathSearchPath(context, xcodeProjectPath);
};
