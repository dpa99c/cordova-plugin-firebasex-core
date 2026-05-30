/**
 * @file before_plugin_install.js
 * @brief Hook script that runs before the core plugin is installed on iOS.
 *
 * Stores the Cordova hook context for use by other utility functions.
 *
 * The plugin now supports Swift Package Manager, so iOS installation no longer
 * hard-requires CocoaPods to be available.
 */
const { setContext } = require('../lib/utilities');

/**
 * Cordova hook entry point.
 * @param {object} context - The Cordova hook context.
 */
module.exports = function(context) {
    setContext(context);
};
