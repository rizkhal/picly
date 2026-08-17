// Metro config for Picly Mobile.
//
// 1. `.onnx` must be treated as an asset (we bundle det_10g / w600k_r50 /
//    ediffiqa_t via require('./assets/*.onnx')) — Metro's default assetExts
//    doesn't include it, so without this `expo export` / `expo run:android`
//    fail with "Unable to resolve module .../det_10g.onnx".
// 2. `pngjs` references Node builtins (`util`, `stream`, `zlib`) that don't
//    exist in React Native. We only use the SYNC PNG decode path
//    (PNG.sync.read), which needs `zlib.inflateSync` — polyfill that one, and
//    shim the rest (never called). `jpeg-js` is pure JS with no requires.

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('onnx');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (['util', 'stream', 'zlib', 'assert', 'buffer'].includes(moduleName)) {
    return {
      type: 'sourceFile',
      filePath: require.resolve('./metro-shims.js'),
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
