/**
 * @file android.js
 * @brief Android-specific build utilities for the cordova-plugin-firebasex-core plugin.
 *
 * Provides helpers for modifying Gradle build files during the Cordova prepare phase.
 * Used by the core plugin and other modular plugins (e.g., crashlytics, performance)
 * that need to inject Gradle classpath dependencies or apply Gradle plugins.
 *
 * @module lib/android
 */
const fs = require('fs');
const path = require('path');
const utilities = require("./utilities");

/** @constant {string} Root directory of the Android platform. */
const ANDROID_PROJECT_ROOT = 'platforms/android';
/** @constant {string} Path to the root-level build.gradle file. */
const ROOT_GRADLE_FILEPATH = ANDROID_PROJECT_ROOT + '/build.gradle';
/** @constant {string} Path to the app-level build.gradle file. */
const APP_GRADLE_FILEPATH = ANDROID_PROJECT_ROOT + '/app/build.gradle';

/** @constant {string} Template for classpath dependency entries. */
const gradleDependencyTemplate = "classpath '{artifactDef}'";
/** @constant {string} Template for apply plugin entries. */
const applyPluginTemplate = "apply plugin: '{pluginDef}'";

const Android = {};

/**
 * Adds a classpath dependency to the root-level build.gradle file.
 * If the dependency already exists, this is a no-op.
 *
 * @param {string} artifactDef - The full artifact definition (e.g., "com.google.firebase:perf-plugin:2.0.1").
 */
Android.addDependencyToRootGradle = function(artifactDef){
    const gradleDependency = gradleDependencyTemplate.replace("{artifactDef}", artifactDef);
    let rootGradle = fs.readFileSync(path.resolve(ROOT_GRADLE_FILEPATH)).toString();
    if(rootGradle.match(gradleDependency)) return;

    rootGradle = rootGradle.replace("dependencies {", "dependencies {\n"+gradleDependency);
    fs.writeFileSync(path.resolve(ROOT_GRADLE_FILEPATH), rootGradle);
    utilities.log("Added dependency to root gradle: " + artifactDef);
};

/**
 * Appends an `apply plugin` statement to the app-level build.gradle file.
 * If the plugin is already applied, this is a no-op.
 *
 * @param {string} pluginDef - The Gradle plugin ID to apply (e.g., "com.google.firebase.firebase-perf").
 */
Android.applyPluginToAppGradle = function(pluginDef){
    const applyPlugin = applyPluginTemplate.replace("{pluginDef}", pluginDef);
    let appGradle = fs.readFileSync(path.resolve(APP_GRADLE_FILEPATH)).toString();
    if(appGradle.match(applyPlugin)) return;

    appGradle += "\n"+applyPlugin;
    fs.writeFileSync(path.resolve(APP_GRADLE_FILEPATH), appGradle);
    utilities.log("Applied plugin to app gradle: " + pluginDef);
};

module.exports = Android;
