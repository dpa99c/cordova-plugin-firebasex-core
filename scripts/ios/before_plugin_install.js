/**
 * @file before_plugin_install.js
 * @brief Hook script that runs before the core plugin is installed on iOS.
 *
 * Validates that CocoaPods is installed and meets the minimum version requirement
 * (^1.11.2). Throws an error if CocoaPods is missing or out-of-date, preventing
 * installation from proceeding with an incompatible environment.
 *
 * Also stores the Cordova hook context for use by other utility functions.
 */
var execSync = require('child_process').execSync;
var semver = require('semver');
const { setContext } = require('../lib/utilities');

/** @constant {string} Minimum required CocoaPods version (semver range). */
var minCocoapodsVersion = "^1.11.2";

/**
 * Cordova hook entry point.
 * @param {object} context - The Cordova hook context.
 */
module.exports = function(context) {
    checkCocoapodsVersion();
    setContext(context);
};

/**
 * Checks that the installed CocoaPods version satisfies the minimum requirement.
 * Throws an error if CocoaPods is not installed, the version is invalid, or is too old.
 */
function checkCocoapodsVersion(){
    var version;
    try{
        version = execSync('pod --version', {encoding: 'utf8'}).match(/(\d+\.\d+\.\d+)/)[1];
    }catch(err){
        throw new Error("cocoapods not found - please install cocoapods >="+minCocoapodsVersion);
    }

    if(!semver.valid(version)){
        throw new Error("cocoapods version is invalid - please reinstall cocoapods@"+minCocoapodsVersion + ": "+version);
    }else if(!semver.satisfies(version, minCocoapodsVersion)){
        throw new Error("cocoapods version is out-of-date - please update to cocoapods@"+minCocoapodsVersion + " - current version: "+version);
    }
}
