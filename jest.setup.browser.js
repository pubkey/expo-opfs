const { TextEncoder, TextDecoder } = require('util');
const { WritableStream, ReadableStream, TransformStream } = require('stream/web');
const { Blob, File } = require('buffer');

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
global.WritableStream = WritableStream;
global.ReadableStream = ReadableStream;
global.TransformStream = TransformStream;
global.Blob = Blob;

global.ArrayBuffer = ArrayBuffer;
global.Uint8Array = Uint8Array;

if (File) {
    global.File = File;
} else {
    class NodePolyfillFile extends Blob {
        constructor(chunks, name, options = {}) {
            super(chunks, options);
            this.name = name;
            this.lastModified = options.lastModified || Date.now();
        }
    }
    global.File = NodePolyfillFile;
}

const { applyPolyfill } = require('./src/index.ts');
applyPolyfill();
