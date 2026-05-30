/**
 * @file utilities.js
 * @brief Shared utility functions for Cordova build hooks in the cordova-plugin-firebasex-core plugin.
 *
 * Provides helpers for parsing XML/JSON configuration files (config.xml, plugin.xml, package.json),
 * resolving plugin variables with a layered override strategy (plugin.xml defaults → config.xml → package.json),
 * copying Firebase key files to platform-specific destinations, and filesystem/logging helpers.
 *
 * @module lib/utilities
 */
var fs = require('fs');
var path = require("path");
var parser = require('xml-js');

/** @private Cached parsed config.xml JSON. */
var _configXml,
    /** @private Cached parsed plugin.xml JSON. */
    _pluginXml,
    /** @private Cordova hook context set via {@link Utilities.setContext}. */
    _context,
    /** @private Cached resolved plugin variables. */
    _pluginVariables;

/** @constant {string} The expected app's Xcode name under `platforms/ios`. Since cordova-ios 8, this is `App`; in cordova <= 7 this was the project name. */
var appNameCordova8Plus = "App"; 

/**
 * The plugin ID of the backward-compatible wrapper meta-plugin.
 * Used as a fallback source for plugin variables in config.xml and package.json,
 * so that variables specified when installing the wrapper are visible to this
 * modular plugin's hook scripts.
 * @constant {string}
 */
var WRAPPER_PLUGIN_ID = "cordova-plugin-firebasex";

var Utilities = {};

/**
 * Recursively creates directories if they do not exist.
 * Polyfill added to the `fs` module for environments lacking `fs.mkdirSync({recursive: true})`.
 *
 * @param {string} dir - The directory path to create.
 */
fs.ensureDirSync = function(dir){
    if(!fs.existsSync(dir)){
        dir.split(path.sep).reduce(function(currentPath, folder){
            currentPath += folder + path.sep;
            if(!fs.existsSync(currentPath)){
                fs.mkdirSync(currentPath);
            }
            return currentPath;
        }, '');
    }
};

/**
 * Stores the Cordova hook context for use by other utility functions.
 * Must be called before using functions that depend on the context (e.g. getPluginId, getAppName).
 *
 * @param {object} context - The Cordova hook context object.
 */
Utilities.setContext = function(context){
    _context = context;
    _pluginVariables = null;
};

/**
 * Returns the Cordova project root when running inside a hook, otherwise falls back
 * to the current working directory.
 *
 * @returns {string} Absolute project root path.
 */
Utilities.getProjectRoot = function(){
    if(_context && _context.opts && _context.opts.projectRoot){
        return _context.opts.projectRoot;
    }
    return process.cwd();
};

/**
 * Returns the root directory for the current plugin.
 *
 * Prefers the installed plugin path inside the Cordova project and falls back to
 * the local repository layout when running directly from the plugin workspace.
 *
 * @param {string} [pluginId] - Plugin identifier to resolve.
 * @returns {string} Absolute plugin root path.
 */
Utilities.getPluginRoot = function(pluginId){
    var resolvedPluginId = pluginId || Utilities.getPluginId();
    var installedPath = path.join(Utilities.getProjectRoot(), 'plugins', resolvedPluginId);
    if(fs.existsSync(path.join(installedPath, 'plugin.xml'))){
        return installedPath;
    }

    var localPath = path.resolve(__dirname, '..', '..');
    if(fs.existsSync(path.join(localPath, 'plugin.xml'))){
        return localPath;
    }

    return installedPath;
};

/**
 * Returns all known Package.swift paths for a plugin.
 *
 * Includes the plugin source copy plus any deployed copies under platforms/ios that
 * declare the same package name.
 *
 * @param {string} [pluginId] - Plugin identifier to resolve.
 * @returns {string[]} Absolute Package.swift paths.
 */
Utilities.getPackageSwiftPaths = function(pluginId){
    var resolvedPluginId = pluginId || Utilities.getPluginId();
    var packagePaths = [];
    var seen = {};

    function addIfExists(filePath){
        if(!filePath || seen[filePath] || !fs.existsSync(filePath)) return;
        seen[filePath] = true;
        packagePaths.push(filePath);
    }

    function collectPackageFiles(rootDir, depth){
        if(depth < 0 || !fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) return;
        fs.readdirSync(rootDir).forEach(function(entry){
            var entryPath = path.join(rootDir, entry);
            var stat = fs.statSync(entryPath);
            if(stat.isDirectory()){
                collectPackageFiles(entryPath, depth - 1);
                return;
            }
            if(entry === 'Package.swift'){
                var contents = fs.readFileSync(entryPath, 'utf8');
                if(contents.indexOf('name: "' + resolvedPluginId + '"') !== -1){
                    addIfExists(entryPath);
                }
            }
        });
    }

    addIfExists(path.join(Utilities.getPluginRoot(resolvedPluginId), 'Package.swift'));
    collectPackageFiles(path.join(Utilities.getProjectRoot(), 'platforms', 'ios'), 4);

    return packagePaths;
};

/**
 * Parses the project's package.json file.
 *
 * @returns {object} The parsed package.json contents, or an empty object if the file doesn't exist.
 */
Utilities.parsePackageJson = function(){
    try {
        return JSON.parse(fs.readFileSync(path.resolve('./package.json')));
    }
    catch (error) {
        if(error.code === "ENOENT") {
            return {}
        }
        throw error;
    }
};

/**
 * Parses the project's config.xml into a JSON object.
 * Results are cached after the first call.
 *
 * @returns {object} The parsed config.xml as a compact JSON object.
 */
Utilities.parseConfigXml = function(){
    if(_configXml) return _configXml;
    _configXml = Utilities.parseXmlFileToJson("config.xml");
    return _configXml;
};

/**
 * Parses the current plugin's plugin.xml into a JSON object.
 * Results are cached after the first call.
 *
 * @returns {object} The parsed plugin.xml as a compact JSON object.
 */
Utilities.parsePluginXml = function(){
    if(_pluginXml) return _pluginXml;
    _pluginXml = Utilities.parseXmlFileToJson("plugins/"+Utilities.getPluginId()+"/plugin.xml");
    return _pluginXml;
};

/**
 * Reads an XML file and converts it to a JSON object using the xml-js library.
 *
 * @param {string} filepath - Relative path to the XML file.
 * @param {object} [parseOpts={compact: true}] - Options passed to xml-js xml2json.
 * @returns {object} The parsed XML as a JSON object.
 */
Utilities.parseXmlFileToJson = function(filepath, parseOpts){
    parseOpts = parseOpts || {compact: true};
    return JSON.parse(parser.xml2json(fs.readFileSync(path.resolve(filepath), 'utf-8'), parseOpts));
};

/**
 * Converts a JSON object back to XML and writes it to a file.
 *
 * @param {object} jsonObj - The JSON object to convert.
 * @param {string} filepath - Relative path to the output XML file.
 * @param {object} [parseOpts={compact: true, spaces: 4}] - Options passed to xml-js json2xml.
 */
Utilities.writeJsonToXmlFile = function(jsonObj, filepath, parseOpts){
    parseOpts = parseOpts || {compact: true, spaces: 4};
    var xmlStr = parser.json2xml(JSON.stringify(jsonObj), parseOpts);
    fs.writeFileSync(path.resolve(filepath), xmlStr);
};

/**
 * Supports both the legacy cordova-ios layout (where the Xcode project is under `platforms/ios/<AppName>.xcodeproj`)
 * and the new cordova-ios 8+ layout (where the Xcode project is under `platforms/ios/App/App.xcodeproj`)
 * by checking for the existence of the new layout first, then falling back to the old layout if not found.
 */
Utilities.getAppSubDirPath = function(iosPlatformPath) {
    var newPath = path.join(iosPlatformPath, appNameCordova8Plus);
    if (fs.existsSync(newPath)) {
        // Cordova-ios 8+ layout detected - use the `App` subdirectory as the base path for Info.plist and entitlements files
        return newPath;
    }
    // Legacy cordova-ios layout - use the name from config.xml as the app subdirectory (which is also the name of the Xcode project)
    var legacyAppName = Utilities.parseConfigXml().widget.name._text.toString().trim();
    return path.join(iosPlatformPath, legacyAppName);
};

/**
 * Determines whether the project is using cordova-ios 8+ by checking for the existence of the `platforms/ios/App` directory.
 *
 * @param {string} iosPlatformPath - Absolute path to the `platforms/ios` directory.
 * @returns {boolean} True if cordova-ios 8+ layout is detected, false otherwise.
 */
Utilities.isCordovaIOS8Plus = function(iosPlatformPath) {
    var appSubDirPath = path.join(iosPlatformPath, appNameCordova8Plus);
    return fs.existsSync(appSubDirPath) && fs.statSync(appSubDirPath).isDirectory();
};

/**
 * Gets the application name used for the iOS platform, supporting both cordova-ios 8+ and legacy layouts.
 * For cordova-ios 8+, this is the name of the subdirectory under `platforms/ios` (usually "App").
 * For legacy cordova-ios versions, this is the project name specified in config.xml.
 * On iOS, uses the cordova-ios API to resolve the Xcode project directory name.
 * On other platforms, falls back to parsing the `<name>` element from config.xml.
 *
 * @returns {string} The application name.
 */
Utilities.getAppName = function(){
    if(!_context){
        console.warn("Cordova context not set; falling back to config.xml parsing for app name");
        return Utilities.parseConfigXml().widget.name._text.toString().trim();
    }
    if(_context.opts.cordova.platforms.indexOf('ios') === -1){
        console.debug("Non-iOS platform detected; using config.xml parsing for app name");
        return Utilities.parseConfigXml().widget.name._text.toString().trim();
    }

    const projectRoot = _context.opts.projectRoot;
    const platformPath = path.join(projectRoot, 'platforms', 'ios');

    // Cordova-ios 8+: skip loading cordova-ios entirely by using the directory check
    if(Utilities.isCordovaIOS8Plus(platformPath)){
        return appNameCordova8Plus;
    }

    // Legacy cordova-ios: prefer the cordova-ios API when the project is fully initialised,
    // but fall back to config.xml during early install phases where the iOS project layout
    // is not yet considered up to date.
    try {
        const cordova_ios = require('cordova-ios');
        const iosProject = new cordova_ios('ios', platformPath);
        return path.basename(iosProject.locations.xcodeCordovaProj);
    } catch (error) {
        console.warn("Unable to resolve legacy iOS project name via cordova-ios; falling back to config.xml: " + error.message);
        return Utilities.parseConfigXml().widget.name._text.toString().trim();
    }
};

/**
 * Returns the current plugin's ID from the Cordova hook context.
 *
 * @returns {string} The plugin ID (e.g., "cordova-plugin-firebasex-core").
 */
Utilities.getPluginId = function(){
    return _context.opts.plugin.id;
};

/**
 * Resolves plugin variables using a three-layer override strategy:
 * 1. Default values from `<preference>` elements in plugin.xml.
 * 2. Overrides from `<variable>` elements for this plugin in config.xml.
 * 3. Overrides from the `cordova.plugins` section of package.json.
 *
 * Results are cached after the first call.
 *
 * @returns {object} A key-value map of resolved plugin variable names to their values.
 */
Utilities.parsePluginVariables = function(){
    if(_pluginVariables) return _pluginVariables;

    var pluginVariables = {};

    // Parse plugin.xml
    var plugin = Utilities.parsePluginXml();
    var prefs = [];
    if(plugin.plugin.preference){
        prefs = prefs.concat(plugin.plugin.preference);
    }
    if(typeof plugin.plugin.platform.length === 'undefined') plugin.plugin.platform = [plugin.plugin.platform];
    plugin.plugin.platform.forEach(function(platform){
        if(platform.preference){
            prefs = prefs.concat(platform.preference);
        }
    });
    prefs.forEach(function(pref){
        if (pref._attributes){
            pluginVariables[pref._attributes.name] = pref._attributes.default;
        }
    });

    // Parse config.xml
    // Check both this plugin's ID and the wrapper meta-plugin ID so that variables
    // specified when installing the wrapper are also picked up.
    var config = Utilities.parseConfigXml();
    var ownPluginId = Utilities.getPluginId();
    (config.widget.plugin ? [].concat(config.widget.plugin) : []).forEach(function(plugin){
        (plugin.variable ? [].concat(plugin.variable) : []).forEach(function(variable){
            var pluginName = plugin._attributes.name || plugin._attributes.id;
            if((pluginName === ownPluginId || pluginName === WRAPPER_PLUGIN_ID) && variable._attributes.name && variable._attributes.value){
                pluginVariables[variable._attributes.name] = variable._attributes.value;
            }
        });
    });

    // Parse package.json
    // Check both this plugin's ID and the wrapper meta-plugin ID.
    // Own plugin ID is checked last so its values take precedence over the wrapper's.
    var packageJSON = Utilities.parsePackageJson();
    if(packageJSON.cordova && packageJSON.cordova.plugins){
        // First, apply wrapper variables as a base layer
        if(packageJSON.cordova.plugins[WRAPPER_PLUGIN_ID]){
            for(const varName in packageJSON.cordova.plugins[WRAPPER_PLUGIN_ID]){
                var varValue = packageJSON.cordova.plugins[WRAPPER_PLUGIN_ID][varName];
                pluginVariables[varName] = varValue;
            }
        }
        // Then, apply this plugin's own variables (higher priority)
        if(packageJSON.cordova.plugins[ownPluginId]){
            for(const varName in packageJSON.cordova.plugins[ownPluginId]){
                var varValue = packageJSON.cordova.plugins[ownPluginId][varName];
                pluginVariables[varName] = varValue;
            }
        }
    }

    if(_context && _context.opts && _context.opts.cli_variables){
        Object.keys(_context.opts.cli_variables).forEach(function(varName){
            pluginVariables[varName] = _context.opts.cli_variables[varName];
        });
    }

    _pluginVariables = pluginVariables;
    return pluginVariables;
};

/**
 * Copies the first found Firebase configuration file (e.g., google-services.json or
 * GoogleService-Info.plist) from the list of source paths to the platform-specific destination.
 * Creates intermediate directories if needed.
 *
 * @param {object} platform - Platform configuration with `src` (array of candidate paths) and `dest` (target path).
 */
Utilities.copyKey = function(platform){
    for(var i = 0; i < platform.src.length; i++){
        var file = platform.src[i];
        if(this.fileExists(file)){
            try{
                var contents = fs.readFileSync(path.resolve(file)).toString();
                try{
                    var destinationPath = platform.dest;
                    var folder = destinationPath.substring(0, destinationPath.lastIndexOf('/'));
                    fs.ensureDirSync(folder);
                    fs.writeFileSync(path.resolve(destinationPath), contents);
                }catch(e){
                    // skip
                }
            }catch(err){
                console.log(err);
            }
            break;
        }
    }
};

/**
 * Checks whether a file exists at the given path.
 *
 * @param {string} filePath - Path to check.
 * @returns {boolean} True if the file exists and is a regular file.
 */
Utilities.fileExists = function(filePath){
    try{
        return fs.statSync(path.resolve(filePath)).isFile();
    }catch(e){
        return false;
    }
};

/**
 * Checks whether a directory exists at the given path.
 *
 * @param {string} dirPath - Path to check.
 * @returns {boolean} True if the path exists and is a directory.
 */
Utilities.directoryExists = function(dirPath){
    try{
        return fs.statSync(path.resolve(dirPath)).isDirectory();
    }catch(e){
        return false;
    }
};

/**
 * Logs an informational message prefixed with the plugin ID.
 * @param {string} msg - The message to log.
 */
Utilities.log = function(msg){
    console.log(Utilities.getPluginId()+': '+msg);
};

/**
 * Logs a warning message prefixed with the plugin ID.
 * @param {string} msg - The warning message.
 */
Utilities.warn = function(msg){
    console.warn(Utilities.getPluginId()+': '+msg);
};

/**
 * Logs an error message prefixed with the plugin ID.
 * @param {string} msg - The error message.
 */
Utilities.error = function(msg){
    console.error(Utilities.getPluginId()+': '+msg);
};

module.exports = Utilities;
