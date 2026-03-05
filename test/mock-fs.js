// Mock implementation of native expo-file-system for JSDOM testing
export const documentDirectory = 'file:///test-doc-dir/';

export const EncodingType = {
    Base64: 'base64',
    Utf8: 'utf8'
};

export const Paths = {
    document: documentDirectory
};

const _memFs = new Map(); // stores entries as { isDir: boolean, data: Uint8Array | null }

class ExpoFileHandleMock {
    constructor(path) {
        this.path = path;
        this.offset = 0;
    }

    get size() {
        const entry = _memFs.get(this.path);
        return entry ? entry.data.length : 0;
    }

    set size(newSize) {
        const entry = _memFs.get(this.path);
        if (entry) {
            const newBuffer = new Uint8Array(newSize);
            const copyLen = Math.min(newSize, entry.data.length);
            newBuffer.set(entry.data.subarray(0, copyLen));
            entry.data = newBuffer;
        }
    }

    readBytes(length) {
        const entry = _memFs.get(this.path);
        if (!entry) throw new Error('File not open');
        const available = Math.max(0, entry.data.length - this.offset);
        const toRead = Math.min(length, available);
        const chunk = entry.data.subarray(this.offset, this.offset + toRead);
        this.offset += toRead;
        return chunk;
    }

    writeBytes(bytes) {
        const entry = _memFs.get(this.path);
        if (!entry) throw new Error('File not open');

        const needed = this.offset + bytes.length;
        if (needed > entry.data.length) {
            const newBuffer = new Uint8Array(needed);
            newBuffer.set(entry.data);
            entry.data = newBuffer;
        }

        entry.data.set(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), this.offset);
        this.offset += bytes.length;
    }

    close() { }
}

export class File {
    constructor(uri) {
        this.uri = typeof uri === 'string' ? uri : uri.join('/');
    }

    get name() {
        const parts = this.uri.replace(/\/$/, '').split('/');
        return parts[parts.length - 1];
    }

    get exists() {
        const entry = _memFs.get(this.uri);
        return entry && !entry.isDir;
    }

    async bytes() {
        if (!this.exists) throw new Error(`File not found: ${this.uri}`);
        return _memFs.get(this.uri).data;
    }

    bytesSync() {
        if (!this.exists) throw new Error(`File not found: ${this.uri}`);
        return _memFs.get(this.uri).data;
    }

    write(content) {
        if (content instanceof Uint8Array) {
            _memFs.set(this.uri, { isDir: false, data: new Uint8Array(content.buffer, content.byteOffset, content.byteLength) });
        } else {
            // naive string to u8
            const encoder = new TextEncoder();
            _memFs.set(this.uri, { isDir: false, data: encoder.encode(content) });
        }
    }

    create() {
        if (this.exists) return;
        _memFs.set(this.uri, { isDir: false, data: new Uint8Array(0) });
    }

    delete() {
        _memFs.delete(this.uri);
    }

    open() {
        if (!this.exists) throw new Error('Cannot open non-existent file');
        return new ExpoFileHandleMock(this.uri);
    }
}

export class Directory {
    constructor(uri, ...parts) {
        let base = typeof uri === 'string' ? uri : uri.uri;
        let joined = [base, ...parts].join('/');
        if (!joined.endsWith('/')) joined += '/';
        this.uri = joined;
    }

    get name() {
        const parts = this.uri.replace(/\/$/, '').split('/');
        return parts[parts.length - 1];
    }

    get exists() {
        const entry = _memFs.get(this.uri);
        return entry && entry.isDir;
    }

    create() {
        _memFs.set(this.uri, { isDir: true, data: null });
    }

    delete() {
        _memFs.delete(this.uri);
        const prefix = this.uri;
        for (const key of _memFs.keys()) {
            if (key.startsWith(prefix)) {
                _memFs.delete(key);
            }
        }
    }

    list() {
        const entries = [];
        const seen = new Set();
        const prefix = this.uri;

        for (const [key, value] of _memFs.entries()) {
            if (key.startsWith(prefix) && key !== prefix) {
                const rest = key.substring(prefix.length);
                const parts = rest.split('/');
                const name = parts[0];

                if (!seen.has(name)) {
                    seen.add(name);
                    const isDir = value.isDir || (parts.length > 1 && parts[1] === '');
                    const entryUri = prefix + name + (isDir ? '/' : '');
                    if (isDir) {
                        const d = new Directory(entryUri);
                        d.isDirectory = true; // explicitly flag for the test logic iterator
                        entries.push(d);
                    } else {
                        const f = new File(prefix + name);
                        f.isDirectory = false;
                        entries.push(f);
                    }
                }
            }
        }
        return entries;
    }
}

// Preserve legacy functions just in case for older parts of the polyfill tests if any
export async function getInfoAsync(path) {
    const entry = _memFs.get(path) || _memFs.get(path + '/');
    if (entry) {
        return { exists: true, isDirectory: entry.isDir };
    }
    return { exists: false };
}

export async function readAsStringAsync(path) {
    const entry = _memFs.get(path);
    if (!entry) throw new Error('File not found');
    if (entry.isDir) throw new Error('Is a directory');
    // tests might still call legacy internally if we don't switch everything
    return entry.data;
}

export async function writeAsStringAsync(path, content) {
    _memFs.set(path, { isDir: false, data: content });
}

export async function makeDirectoryAsync(path) {
    _memFs.set(path, { isDir: true, data: null });
}

export async function deleteAsync(path) {
    _memFs.delete(path);
    const prefix = path.endsWith('/') ? path : (path + '/');
    for (const key of _memFs.keys()) {
        if (key.startsWith(prefix)) {
            _memFs.delete(key);
        }
    }
}

export async function readDirectoryAsync(path) {
    const entries = [];
    const prefix = path.endsWith('/') ? path : (path + '/');
    for (const [key] of _memFs.entries()) {
        if (key.startsWith(prefix) && key !== prefix) {
            const rest = key.substring(prefix.length);
            const parts = rest.split('/');
            const firstLvl = parts[0];
            if (!entries.includes(firstLvl)) {
                entries.push(firstLvl);
            }
        }
    }
    return entries;
}
