// Tiny shims for Node builtins that pngjs references (`util`, `stream`,
// `zlib`, `buffer`) but that don't exist in React Native. We only use pngjs's
// SYNC decoder (PNG.sync.read) — the async/packer APIs are never called.
//
// zlib: the sync PNG decode path needs `zlib.Inflate` (constructor-style) plus
// `zlib.inflateSync` (the sync helper wraps the constructor). We implement
// both with the synchronous `inflateRawSync` from `fflate` (pure JS, installed
// at the workspace root via pngjs's own dependency tree) and skip the
// `_processChunk` async plumbing.

const { inflateSync, inflateRawSync } = require('fflate');

class Inflate {
  constructor() {}
  _processChunk(chunk, flushFlag, asyncCb) {
    // Sync path never calls this; if it did, return the raw-inflated bytes.
    return inflateRawSync(new Uint8Array(chunk));
  }
  close() {}
}
Inflate._processChunk = (chunk, flushFlag) => inflateRawSync(new Uint8Array(chunk));

module.exports = {
  // util
  inspect: () => '',
  format: (...args) => args.map(String).join(' '),
  inherits: (ctor, superCtor) => {
    ctor.super_ = superCtor;
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: { value: ctor, enumerable: false, writable: true, configurable: true },
    });
  },
  deprecate: (fn) => fn,
  // assert
  ok: () => true,
  // buffer
  kMaxLength: 0x7fffffff,
  Buffer: {
    isBuffer: () => false,
    from: (v) => v,
  },
  // stream
  Stream: function () {},
  Readable: function () {},
  Writable: function () {},
  Transform: function () {},
  Duplex: function () {},
  PassThrough: function () {},
  // zlib
  Inflate,
  inflateSync: (buf) => inflateSync(new Uint8Array(buf)),
  inflateRawSync: (buf) => inflateRawSync(new Uint8Array(buf)),
  Z_MIN_CHUNK: 1024,
  Z_FINISH: 4,
  constants: {
    Z_NO_FLUSH: 0,
    Z_FINISH: 4,
    Z_DEFAULT_COMPRESSION: -1,
    Z_DEFAULT_STRATEGY: 0,
  },
};
