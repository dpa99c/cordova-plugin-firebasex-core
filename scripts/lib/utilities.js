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
 * Gets the application name.
 * On iOS, uses the cordova-ios API to resolve the Xcode project directory name.
 * On other platforms, falls back to parsing the `<name>` element from config.xml.
 *
 * @returns {string} The application name.
 */
Utilities.getAppName = function(){
    if(_context && _context.opts.cordova.platforms.indexOf('ios') !== -1){
        const projectRoot = _context.opts.projectRoot;
        const platformPath = path.join(projectRoot, 'platforms', 'ios');
        const cordova_ios = require('cordova-ios');
        const iosProject = new cordova_ios('ios', platformPath);
        return path.basename(iosProject.locations.xcodeCordovaProj);
    }
    return Utilities.parseConfigXml().widget.name._text.toString().trim();
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
    var config = Utilities.parseConfigXml();
    (config.widget.plugin ? [].concat(config.widget.plugin) : []).forEach(function(plugin){
        (plugin.variable ? [].concat(plugin.variable) : []).forEach(function(variable){
            if((plugin._attributes.name === Utilities.getPluginId() || plugin._attributes.id === Utilities.getPluginId()) && variable._attributes.name && variable._attributes.value){
                pluginVariables[variable._attributes.name] = variable._attributes.value;
            }
        });
    });

    // Parse package.json
    var packageJSON = Utilities.parsePackageJson();
    if(packageJSON.cordova && packageJSON.cordova.plugins){
        for(const pluginId in packageJSON.cordova.plugins){
            if(pluginId === Utilities.getPluginId()){
                for(const varName in packageJSON.cordova.plugins[pluginId]){
                    var varValue = packageJSON.cordova.plugins[pluginId][varName];
                    pluginVariables[varName] = varValue;
                }
            }
        }
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
