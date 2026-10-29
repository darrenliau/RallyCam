const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Lets the person detector model (.tflite) be bundled with require().
config.resolver.assetExts.push('tflite');

module.exports = config;
