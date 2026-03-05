# expo-opfs

OPFS polyfill for expo based on the Expo Filesystem API.


## Resources

- OPFS docs https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
- OPFS API https://web.dev/articles/origin-private-file-system?hl=en
- Good test-suite to test OPFS: https://github.com/jurerotar/opfs-mock/blob/master/src/opfs.test.ts
- Expo Filesystem API https://docs.expo.dev/versions/latest/sdk/filesystem/

## Usage

You can use this module either by applying a polyfill to the global `navigator` environment or by importing the `opfs` api object directly.

### 1. Polyfill the Global Environment

To polyfill `navigator.storage.getDirectory` in your Expo application, import the package and call `applyPolyfill()` at your project's entry point (e.g., `App.js` or `index.js`).

```typescript
import { applyPolyfill } from 'expo-opfs';

applyPolyfill();

// Now you can safely use the standard OPFS API:
async function writeData() {
  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle('my-file.txt', { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write('Hello, world!');
  await writable.close();
}
```

### 2. Import the OPFS Object Directly

If you prefer not to modify the global `navigator` environment, you can import the `opfs` instance directly from the package:

```typescript
import { opfs } from 'expo-opfs';

async function writeData() {
  const root = await opfs.getDirectory();
  const fileHandle = await root.getFileHandle('my-file.txt', { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write('Hello, world!');
  await writable.close();
}
```

## Limitations

Currently, this polyfill only implements the **asynchronous** OPFS API. 

The `FileSystemSyncAccessHandle` interface, which provides fully synchronous `read()`, `write()`, and `flush()` methods (often used by high-performance WASM applications like SQLite inside Web Workers), is **not supported**. 

This limitation exists because the underlying `expo-file-system` wrapper relies on the asynchronous React Native bridge and does not currently expose fully blocking, synchronous file I/O operations to JavaScript.