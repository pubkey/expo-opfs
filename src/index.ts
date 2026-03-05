import * as FileSystem from 'expo-file-system/legacy';

const OPFS_ROOT = FileSystem.documentDirectory + '.expo-opfs/';

// Base64 lookup tables
const b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const b64lookup = new Uint8Array(256);
for (let i = 0; i < b64chars.length; i++) {
    b64lookup[b64chars.charCodeAt(i)] = i;
}

export function encodeBase64(bytes: Uint8Array): string {
    let result = '';
    const len = bytes.length;
    for (let i = 0; i < len; i += 3) {
        result += b64chars[bytes[i] >> 2];
        result += b64chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
        result += b64chars[((bytes[i + 1] & 15) << 2) | (bytes[i + 2] >> 6)];
        result += b64chars[bytes[i + 2] & 63];
    }
    if (len % 3 === 2) {
        result = result.substring(0, result.length - 1) + '=';
    } else if (len % 3 === 1) {
        result = result.substring(0, result.length - 2) + '==';
    }
    return result;
}

export function decodeBase64(base64: string): Uint8Array {
    let validLen = base64.indexOf('=');
    if (validLen === -1) validLen = base64.length;
    const placeHoldersLen = validLen === base64.length ? 0 : base64.length - validLen;
    const str = base64.substring(0, validLen);
    const len = str.length;

    const bufferLength = Math.floor((base64.length * 3) / 4) - placeHoldersLen;
    const bytes = new Uint8Array(bufferLength);

    let p = 0;
    for (let i = 0; i < len; i += 4) {
        const encoded1 = b64lookup[base64.charCodeAt(i)];
        const encoded2 = b64lookup[base64.charCodeAt(i + 1)];
        const encoded3 = b64lookup[base64.charCodeAt(i + 2)];
        const encoded4 = b64lookup[base64.charCodeAt(i + 3)];

        bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
        if (p < bufferLength) bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
        if (p < bufferLength) bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
    }
    return bytes;
}

export class FileSystemHandle {
    readonly kind: 'file' | 'directory';
    readonly name: string;
    protected readonly path: string;

    constructor(kind: 'file' | 'directory', name: string, path: string) {
        this.kind = kind;
        this.name = name;
        this.path = path;
    }

    async isSameEntry(other: FileSystemHandle): Promise<boolean> {
        return this.path === (other as any).path && this.kind === other.kind;
    }

    async queryPermission(options?: any): Promise<string> {
        return 'granted';
    }

    async requestPermission(options?: any): Promise<string> {
        return 'granted';
    }
}

export class FileSystemFileHandle extends FileSystemHandle {
    constructor(name: string, path: string) {
        super('file', name, path);
    }

    async getFile(): Promise<File> {
        let contentBytes: Uint8Array = new Uint8Array(0);
        try {
            const b64 = await FileSystem.readAsStringAsync(this.path, { encoding: FileSystem.EncodingType.Base64 });
            contentBytes = decodeBase64(b64);
        } catch (e) {
            throw new DOMException('File could not be read', 'NotFoundError');
        }

        // In environments where File is polyfilled (like Jest JSDOM via Blob), use it
        if (typeof File !== 'undefined') {
            return new File([contentBytes as any], this.name, { lastModified: Date.now() });
        }

        // Fallback if no File global exists
        const b = new Blob([contentBytes as any]);
        (b as any).name = this.name;
        (b as any).lastModified = Date.now();
        return b as unknown as File;
    }

    async createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream> {
        let initialBytes: Uint8Array = new Uint8Array(0);
        if (options?.keepExistingData) {
            try {
                const b64 = await FileSystem.readAsStringAsync(this.path, { encoding: FileSystem.EncodingType.Base64 });
                initialBytes = decodeBase64(b64);
            } catch (e) {
                // file doesn't exist or can't be read, start empty
            }
        }
        return new FileSystemWritableFileStream(this.path, initialBytes);
    }
}

type WriteParams = {
    type: 'write' | 'seek' | 'truncate';
    data?: string | BufferSource | Blob;
    position?: number;
    size?: number;
};

export class FileSystemWritableFileStream {
    private path: string;
    private buffer: Uint8Array;
    private cursor: number = 0;
    private isClosed: boolean = false;
    private isErrored: boolean = false;
    private _errorReason: any = null;

    constructor(path: string, initialBytes: Uint8Array) {
        this.path = path;
        this.buffer = new Uint8Array(initialBytes);
    }

    async write(data: string | BufferSource | Blob | WriteParams): Promise<void> {
        if (this.isErrored) {
            throw typeof this._errorReason === 'string' ? new Error(this._errorReason) : this._errorReason;
        }
        if (this.isClosed) throw new TypeError('Cannot write to a CLOSED writable stream');

        if (data === undefined || data === null) {
            throw new TypeError("Failed to execute 'write' on 'FileSystemWritableFileStream': Invalid params passed. write requires a non-null data");
        }

        if (typeof data === 'object' && 'type' in data && (data.type === 'write' || data.type === 'seek' || data.type === 'truncate')) {
            const p = data as WriteParams;
            if (p.type === 'truncate') {
                if (p.size === undefined || p.size < 0) throw new TypeError('Invalid size value');
                await this.truncate(p.size);
                return;
            } else if (p.type === 'seek') {
                if (p.position === undefined || p.position < 0) throw new TypeError('Invalid position value');
                this.cursor = p.position;
                return;
            } else if (p.type === 'write') {
                if (p.position !== undefined) {
                    if (p.position < 0) throw new TypeError('Invalid position value');
                    this.cursor = p.position;
                }
                const writeData = p.data;
                if (writeData === undefined || writeData === null) return; // Spec: type write with null data is no-op
                await this.writeChunk(writeData);
                return;
            }
        } else {
            await this.writeChunk(data as string | BufferSource | Blob);
        }
    }

    private async writeChunk(data: string | BufferSource | Blob) {
        let bytes: Uint8Array;

        if (typeof data === 'string') {
            bytes = new TextEncoder().encode(data);
        } else if (data instanceof Blob) {
            if (typeof data.arrayBuffer === 'function') {
                const ab = await data.arrayBuffer();
                bytes = new Uint8Array(ab);
            } else {
                const b64 = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        const result = reader.result as string;
                        // extract base64 part
                        const b64Data = result.split(',')[1];
                        resolve(b64Data);
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(data);
                });
                bytes = decodeBase64(b64);
            }
        } else if (ArrayBuffer.isView(data)) {
            bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        } else if (data instanceof ArrayBuffer) {
            bytes = new Uint8Array(data);
        } else {
            throw new TypeError('Invalid data type');
        }

        const neededSize = this.cursor + bytes.length;
        let newBuffer = this.buffer;
        if (neededSize > this.buffer.length) {
            newBuffer = new Uint8Array(neededSize);
            newBuffer.set(this.buffer);
        }

        newBuffer.set(bytes, this.cursor);
        this.buffer = newBuffer;
        this.cursor += bytes.length;
    }

    async truncate(size: number): Promise<void> {
        if (this.isErrored) throw this._errorReason ?? new TypeError('Stream is errored');
        if (this.isClosed) throw new TypeError('Stream is closed');
        if (size < 0) throw new DOMException('IndexSizeError', 'IndexSizeError');
        if (size === this.buffer.length) return;

        const newBuffer = new Uint8Array(size);
        const copyLen = Math.min(size, this.buffer.length);
        newBuffer.set(this.buffer.subarray(0, copyLen));
        this.buffer = newBuffer;

        if (this.cursor > size) {
            this.cursor = size;
        }
    }

    async seek(position: number): Promise<void> {
        if (this.isErrored) throw this._errorReason ?? new TypeError('Stream is errored');
        if (this.isClosed) throw new TypeError('Stream is closed');
        if (position < 0) throw new DOMException('IndexSizeError', 'IndexSizeError');
        this.cursor = position;
    }

    async close(): Promise<void> {
        if (this.isErrored) {
            throw new TypeError('Cannot close a ERRORED writable stream');
        }
        if (this.isClosed) throw new TypeError('Cannot create writer when WritableStream is locked');
        const b64 = encodeBase64(this.buffer);
        await FileSystem.writeAsStringAsync(this.path, b64, { encoding: FileSystem.EncodingType.Base64 });
        this.isClosed = true;
    }

    getWriter() {
        return {
            write: async (chunk: any) => this.write(chunk),
            close: async () => this.close(),
            abort: async (reason?: any) => this.abort(reason),
            releaseLock: () => { },
            get closed() { return Promise.resolve() } // simplified
        }
    }

    async abort(reason?: any): Promise<void> {
        this.isErrored = true;
        this._errorReason = reason ?? new TypeError('Stream was aborted');
    }
}

export class FileSystemDirectoryHandle extends FileSystemHandle {
    constructor(name: string, path: string) {
        super('directory', name, path);
    }

    async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle> {
        const fullPath = this.path + name;
        const dirPath = fullPath + '/';

        const info = await FileSystem.getInfoAsync(fullPath);
        const dirInfo = await FileSystem.getInfoAsync(dirPath);

        if (dirInfo.exists && dirInfo.isDirectory) {
            throw new DOMException(`A directory with the same name exists: ${name}`, 'TypeMismatchError');
        }

        if (info.exists) {
            return new FileSystemFileHandle(name, fullPath);
        }

        if (options?.create) {
            await FileSystem.writeAsStringAsync(fullPath, '', { encoding: FileSystem.EncodingType.UTF8 });
            return new FileSystemFileHandle(name, fullPath);
        }

        throw new DOMException('A requested file or directory could not be found at the time an operation was processed.', 'NotFoundError');
    }

    async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle> {
        const fullPath = this.path + name + '/';
        const filePath = this.path + name;

        const info = await FileSystem.getInfoAsync(fullPath);
        const fileInfo = await FileSystem.getInfoAsync(filePath);

        if (fileInfo.exists && !fileInfo.isDirectory) {
            throw new DOMException(`A file with the same name exists: ${name}`, 'TypeMismatchError');
        }

        if (info.exists) {
            return new FileSystemDirectoryHandle(name, fullPath);
        }

        if (options?.create) {
            await FileSystem.makeDirectoryAsync(fullPath, { intermediates: true });
            return new FileSystemDirectoryHandle(name, fullPath);
        }

        throw new DOMException('A requested file or directory could not be found at the time an operation was processed.', 'NotFoundError');
    }

    async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
        const fileInfo = await FileSystem.getInfoAsync(this.path + name);
        const dirInfo = await FileSystem.getInfoAsync(this.path + name + '/');
        const targetInfo = fileInfo.exists ? fileInfo : dirInfo;
        const fullPath = fileInfo.exists ? (this.path + name) : (this.path + name + '/');

        if (!targetInfo.exists) {
            throw new DOMException('A requested file or directory could not be found at the time an operation was processed.', 'NotFoundError');
        }

        if (targetInfo.isDirectory && !options?.recursive) {
            const contents = await FileSystem.readDirectoryAsync(fullPath);
            if (contents.length > 0) {
                throw new DOMException('The object can not be modified in this way.', 'InvalidModificationError');
            }
        }

        await FileSystem.deleteAsync(fullPath, { idempotent: true });
    }

    async resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null> {
        const descendantPath = (possibleDescendant as any).path;
        if (!descendantPath.startsWith(this.path)) return null;
        if (descendantPath === this.path) return [];

        // strip the root path off
        let relative = descendantPath.substring(this.path.length);
        if (relative.endsWith('/')) {
            relative = relative.slice(0, -1);
        }
        return relative.split('/');
    }

    async *keys(): AsyncIterableIterator<string> {
        const entries = await FileSystem.readDirectoryAsync(this.path);
        for (const entry of entries) {
            yield entry;
        }
    }

    async *values(): AsyncIterableIterator<FileSystemHandle> {
        const entries = await FileSystem.readDirectoryAsync(this.path);
        for (const entry of entries) {
            if (entry === '.keep') continue; // Hide the polyfill directory marker

            const entryPath = this.path + entry;
            let info = await FileSystem.getInfoAsync(entryPath);
            // In some environments, a directory might need a trailing slash to accurately return isDirectory. 
            // In our JSDOM mock, it explicitly checks exact match. So we try the plain path first, then with trailing slash if not found/classified.
            if (!info.exists) {
                const dirInfo = await FileSystem.getInfoAsync(entryPath + '/');
                if (dirInfo.exists) {
                    info = dirInfo;
                }
            }

            if (info.isDirectory) {
                yield new FileSystemDirectoryHandle(entry, entryPath + '/');
            } else {
                yield new FileSystemFileHandle(entry, entryPath);
            }
        }
    }

    async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
        for await (const val of this.values()) {
            yield [val.name, val];
        }
    }

    [Symbol.asyncIterator]() {
        return this.entries();
    }
}

export const opfs = {
    getDirectory: async (): Promise<FileSystemDirectoryHandle> => {
        const info = await FileSystem.getInfoAsync(OPFS_ROOT);
        if (!info.exists) {
            await FileSystem.makeDirectoryAsync(OPFS_ROOT, { intermediates: true });
        }
        return new FileSystemDirectoryHandle('', OPFS_ROOT);
    }
};

export function applyPolyfill() {
    // Note: To match standard OPFS behavior where getDirectory() returns a new promise each time,
    // we just assign the method directly.
    if (typeof navigator !== 'undefined') {
        (navigator as any).storage = (navigator as any).storage || {};
        (navigator as any).storage.getDirectory = opfs.getDirectory;
    }
}
