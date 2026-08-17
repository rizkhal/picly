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
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('onnx');

// onnxruntime-react-native declares `react-native: lib/index` (TS source) and
// imports `onnxruntime-common`. In the npm workspace the root hoists a NEWER
// onnxruntime-common (1.27, pulled in by picly-ml), so Metro resolves
// `lib/index.ts`'s import to 1.27 — whose backend API changed and
// `InferenceSession` comes back undefined. Pin the nested 1.24.3 copy that
// ships inside onnxruntime-react-native via extraNodeModules.
const ORT_COMMON = path.join(
  __dirname,
  '..',
  '..',
  'node_modules',
  'onnxruntime-react-native',
  'node_modules',
  'onnxruntime-common',
);
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  'onnxruntime-common': ORT_COMMON,
};

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
