import { File as ExpoFile, Directory as ExpoDirectory, Paths } from 'expo-file-system';
export { EXPO_OPFS_VERSION } from './version';

const OPFS_ROOT = new ExpoDirectory(Paths.document, '.expo-opfs');

if (typeof globalThis.DOMException === 'undefined') {
    (globalThis as any).DOMException = class DOMException extends Error {
        constructor(message?: string, name?: string) {
            super(message);
            this.name = name ?? 'DOMException';
        }
    };
}

function isValidName(name: string): boolean {
    return name !== '' && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\');
}

const accessHandles = new Set<string>();
const openWritableStreams = new Map<string, number>();

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
    private fileNode: ExpoFile;

    constructor(name: string, path: string) {
        super('file', name, path);
        this.fileNode = new ExpoFile(path);
    }

    async getFile(): Promise<File> {
        let size: number = 0;
        const lastModified: number = Date.now();

        if (!this.fileNode.exists) {
            throw new DOMException('File could not be read', 'NotFoundError');
        }

        try {
            const handle = this.fileNode.open();
            size = handle.size ?? 0;
            // Native Expo fileHandle doesn't expose lastModified yet, so grab current Date
            handle.close();
        } catch (e) {
            throw new DOMException('File could not be read', 'NotFoundError');
        }

        const createLazyFile = (node: ExpoFile, startOffset: number, length: number, name: string, lastModified: number, type: string, sharedState?: { handle: any }) => {
            const state = sharedState || { handle: null };

            return {
                name,
                lastModified,
                size: length,
                type,
                arrayBuffer: async () => {
                    if (length === 0) return new ArrayBuffer(0);
                    const handle = node.open();
                    handle.offset = startOffset;
                    const data = handle.readBytes(length);
                    handle.close();
                    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
                },
                text: async () => {
                    if (length === 0) return '';
                    const handle = node.open();
                    handle.offset = startOffset;
                    const data = handle.readBytes(length);
                    handle.close();
                    return new TextDecoder().decode(data);
                },
                slice: (start?: number, end?: number, contentType?: string) => {
                    const sliceStart = start !== undefined ? (start < 0 ? Math.max(length + start, 0) : Math.min(start, length)) : 0;
                    const sliceEnd = end !== undefined ? (end < 0 ? Math.max(length + end, 0) : Math.min(end, length)) : length;
                    const sliceLength = Math.max(sliceEnd - sliceStart, 0);

                    return createLazyFile(node, startOffset + sliceStart, sliceLength, name, lastModified, contentType || '', state);
                },
                stream: () => {
                    if (typeof ReadableStream !== 'undefined') {
                        return new ReadableStream({
                            async start(controller) {
                                if (length === 0) {
                                    controller.close();
                                    return;
                                }
                                const handle = node.open();
                                handle.offset = startOffset;

                                const CHUNK_SIZE = 64 * 1024; // 64KB chunks
                                let bytesRead = 0;
                                try {
                                    while (bytesRead < length) {
                                        const chunkLength = Math.min(CHUNK_SIZE, length - bytesRead);
                                        const data = handle.readBytes(chunkLength);
                                        controller.enqueue(data);
                                        bytesRead += chunkLength;

                                        // Yield to event loop every few chunks for large files
                                        if (bytesRead % (CHUNK_SIZE * 16) === 0) {
                                            await new Promise(resolve => setTimeout(resolve, 0));
                                        }
                                    }
                                } finally {
                                    handle.close();
                                }
                                controller.close();
                            }
                        });
                    }
                    throw new Error('ReadableStream not supported');
                }
            } as unknown as File;
        };

        return createLazyFile(this.fileNode, 0, size, this.name, lastModified, 'application/octet-stream');
    }

    async createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream> {
        if (accessHandles.has(this.path)) throw new DOMException('The object can not be modified in this way.', 'NoModificationAllowedError');

        const count = openWritableStreams.get(this.path) ?? 0;
        openWritableStreams.set(this.path, count + 1);

        return new FileSystemWritableFileStream(this.path, options?.keepExistingData ?? false, () => {
            const currentCount = openWritableStreams.get(this.path) ?? 0;
            if (currentCount <= 1) {
                openWritableStreams.delete(this.path);
            } else {
                openWritableStreams.set(this.path, currentCount - 1);
            }
        });
    }

    async createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> {
        if (accessHandles.has(this.path) || openWritableStreams.has(this.path)) throw new DOMException('The object can not be modified in this way.', 'NoModificationAllowedError');
        if (!this.fileNode.exists) {
            throw new DOMException('A requested file or directory could not be found at the time an operation was processed.', 'NotFoundError');
        }

        accessHandles.add(this.path);
        return new FileSystemSyncAccessHandle(this.fileNode.open(), this.fileNode, () => accessHandles.delete(this.path));
    }
}

export class FileSystemSyncAccessHandle {
    private fileHandle: any;
    private fileNode: any;
    private isClosed: boolean = false;
    private onClose: () => void;

    constructor(fileHandle: any, fileNode: any, onClose: () => void) {
        this.fileHandle = fileHandle;
        this.fileNode = fileNode;
        this.onClose = onClose;
    }

    read(buffer: ArrayBuffer | ArrayBufferView, options?: { at: number }): number {
        if (this.isClosed) throw new DOMException('An attempt was made to use an object that is not, or is no longer, usable', 'InvalidStateError');
        if (options?.at !== undefined) {
            this.fileHandle.offset = options.at;
        }

        const view = new Uint8Array(
            (buffer as ArrayBufferView).buffer || buffer,
            (buffer as ArrayBufferView).byteOffset || 0,
            (buffer as ArrayBufferView).byteLength || (buffer as ArrayBuffer).byteLength
        );

        const currentSize = this.getSize();
        const currentOffset = this.fileHandle.offset;

        if (currentOffset >= currentSize) {
            return 0; // EOF reached, nothing to read
        }

        const bytesToRead = view.byteLength;
        const available = Math.max(0, currentSize - currentOffset);
        const actualBytesToRead = Math.min(bytesToRead, available);

        if (actualBytesToRead <= 0) {
            return 0;
        }

        const readData: Uint8Array = this.fileHandle.readBytes(actualBytesToRead);

        view.set(readData);
        return readData.length;
    }

    write(buffer: ArrayBuffer | ArrayBufferView, options?: { at: number }): number {
        if (this.isClosed) throw new DOMException('An attempt was made to use an object that is not, or is no longer, usable', 'InvalidStateError');

        // Native JSI access optimization: Only check bounds and pad if specific `at` offsets 
        // manually skip beyond the known bounds, preventing unnecessary size() lookups.
        if (options?.at !== undefined) {
            this.fileHandle.offset = options.at;
            const currentSize = this.getSize();
            if (this.fileHandle.offset > currentSize) {
                // Native systems may not zero-pad implicitly if we seek beyond EOF
                const padLen = this.fileHandle.offset - currentSize;
                const padding = new Uint8Array(padLen);
                const targetOffset = this.fileHandle.offset;

                this.fileHandle.offset = currentSize;
                this.fileHandle.writeBytes(padding);
                this.fileHandle.offset = targetOffset;
            }
        }

        const view = new Uint8Array(
            (buffer as ArrayBufferView).buffer || buffer,
            (buffer as ArrayBufferView).byteOffset || 0,
            (buffer as ArrayBufferView).byteLength || (buffer as ArrayBuffer).byteLength
        );

        this.fileHandle.writeBytes(view);
        return view.length;
    }

    getSize(): number {
        if (this.isClosed) throw new DOMException('An attempt was made to use an object that is not, or is no longer, usable', 'InvalidStateError');
        return this.fileHandle.size;
    }

    truncate(newSize: number): void {
        if (this.isClosed) throw new DOMException('An attempt was made to use an object that is not, or is no longer, usable', 'InvalidStateError');
        if (newSize < 0) throw new DOMException('IndexSizeError', 'IndexSizeError');
        if (newSize === this.fileHandle.size) return;

        // Try to update natively/via mock natively
        try {
            this.fileHandle.size = newSize;
        } catch (e) {
            // Native read-only size assignment fallback
        }

        if (this.fileHandle.size !== newSize) {
            // Fallback rewrite approach if native JSI size assignment is readonly
            const currentOffset = this.fileHandle.offset;
            this.fileHandle.offset = 0;
            const fullData = this.fileHandle.readBytes(this.fileHandle.size);

            const resized = new Uint8Array(newSize);
            resized.set(fullData.subarray(0, Math.min(newSize, fullData.length)));

            this.fileHandle.close();
            this.fileNode.write(resized);
            this.fileHandle = this.fileNode.open();
            this.fileHandle.offset = Math.min(currentOffset, newSize);
        }
    }

    flush(): void {
        if (this.isClosed) throw new DOMException('An attempt was made to use an object that is not, or is no longer, usable', 'InvalidStateError');
        // Synchronous operations physically write to device natively in Expo SDK 55
    }

    close(): void {
        if (this.isClosed) return;
        this.fileHandle.close();
        this.isClosed = true;
        this.onClose();
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
    private fileNode: ExpoFile;
    private swapNode: ExpoFile;
    private fileHandle: any = null; // Expo FileHandle
    private cursor: number = 0;
    private isClosed: boolean = false;
    private isErrored: boolean = false;
    private _errorReason: any = null;
    private onClose: () => void;
    private keepExistingData: boolean;

    constructor(path: string, keepExistingData: boolean, onClose: () => void) {
        this.path = path;
        this.fileNode = new ExpoFile(path);

        // OPFS requires atomic writes.
        // We stream to a swap file to prevent partial writes from being visible
        // before close() is called.
        this.swapNode = new ExpoFile(path + '.swap.' + Math.random().toString(36).slice(2) + Date.now());

        this.keepExistingData = keepExistingData;
        this.onClose = onClose;
    }

    private lazyInit() {
        if (!this.fileHandle) {
            if (this.swapNode.exists) {
                this.swapNode.delete();
            }
            this.swapNode.create();

            if (this.keepExistingData && this.fileNode.exists) {
                // Copy existing data into the swap file if we are keeping it
                const existingHandle = this.fileNode.open();
                const swapHandle = this.swapNode.open();
                const data = existingHandle.readBytes(existingHandle.size ?? 0);
                swapHandle.writeBytes(data);
                existingHandle.close();
                swapHandle.close();
            }

            this.fileHandle = this.swapNode.open();
        }
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

                let binaryStr = '';
                if (typeof atob === 'function') {
                    binaryStr = atob(b64);
                } else if ('Buffer' in globalThis) {
                    binaryStr = (globalThis as any).Buffer.from(b64, 'base64').toString('binary');
                }

                bytes = new Uint8Array(binaryStr.length);
                for (let i = 0; i < binaryStr.length; i++) {
                    bytes[i] = binaryStr.charCodeAt(i);
                }
            }
        } else if (ArrayBuffer.isView(data)) {
            bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        } else if (data instanceof ArrayBuffer) {
            bytes = new Uint8Array(data);
        } else {
            throw new TypeError('Invalid data type');
        }

        this.lazyInit();
        this.fileHandle.offset = this.cursor;
        this.fileHandle.writeBytes(bytes);
        this.cursor += bytes.length;
    }

    async truncate(size: number): Promise<void> {
        if (this.isErrored) throw this._errorReason ?? new TypeError('Stream is errored');
        if (this.isClosed) throw new TypeError('Stream is closed');
        if (size < 0) throw new DOMException('IndexSizeError', 'IndexSizeError');
        this.lazyInit();

        const currentSize = this.fileHandle.size;
        if (size === currentSize) return;

        try {
            this.fileHandle.size = size;
        } catch (e) {
            // Fallback if size assignment is readonly in some Expo SDKs
        }

        if (this.fileHandle.size !== size) {
            const currentOffset = this.fileHandle.offset;
            this.fileHandle.offset = 0;
            const fullData = this.fileHandle.readBytes(this.fileHandle.size);
            const resized = new Uint8Array(size);
            resized.set(fullData.subarray(0, Math.min(size, fullData.length)));

            this.fileHandle.close();
            this.swapNode.write(resized);
            this.fileHandle = this.swapNode.open();
            this.fileHandle.offset = Math.min(currentOffset, size);
        }

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

        try {
            if (this.fileHandle) {
                this.fileHandle.close();

                // Atomic commit: move swap file over the original file
                if (this.fileNode.exists) {
                    this.fileNode.delete();
                }
                // Workaround for expo-file-system lack of synchronous move:
                // Read swap file completely and write to the target natively
                const swapHandle = this.swapNode.open();
                const finalData = swapHandle.readBytes(swapHandle.size ?? 0);
                swapHandle.close();

                this.fileNode.create();
                const finalHandle = this.fileNode.open();
                finalHandle.writeBytes(finalData);
                finalHandle.close();

                this.swapNode.delete();
            } else {
                // Zero-byte file that was created and immediately closed
                if (!this.fileNode.exists) {
                    this.fileNode.create();
                } else if (!this.keepExistingData) {
                    this.fileNode.delete();
                    this.fileNode.create();
                }
            }
        } finally {
            this.isClosed = true;
            this.onClose();
        }
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
        if (this.isErrored) return;
        this.isErrored = true;
        this._errorReason = reason ?? new TypeError('Stream was aborted');

        if (this.fileHandle) {
            try { this.fileHandle.close(); } catch (e) { /* ignore */ }
        }
        if (this.swapNode.exists) {
            try { this.swapNode.delete(); } catch (e) { /* ignore */ }
        }

        if (!this.isClosed) {
            this.isClosed = true;
            this.onClose();
        }
    }
}

export class FileSystemDirectoryHandle extends FileSystemHandle {
    private dirNode: ExpoDirectory;

    constructor(name: string, path: string) {
        super('directory', name, path);
        this.dirNode = new ExpoDirectory(path);
    }

    async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle> {
        if (!isValidName(name)) throw new TypeError(`Name is not allowed: ${name}`);
        const fullPath = this.path + name;
        const fileNode = new ExpoFile(fullPath);

        if (fileNode.exists) {
            return new FileSystemFileHandle(name, fullPath);
        }

        const dirNode = new ExpoDirectory(fullPath);
        if (dirNode.exists) {
            throw new DOMException(`A directory with the same name exists: ${name}`, 'TypeMismatchError');
        }

        if (options?.create) {
            fileNode.create();
            return new FileSystemFileHandle(name, fullPath);
        }

        throw new DOMException('A requested file or directory could not be found at the time an operation was processed.', 'NotFoundError');
    }

    async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle> {
        if (!isValidName(name)) throw new TypeError(`Name is not allowed: ${name}`);
        const fullPath = this.path + name + '/';
        const fullNode = new ExpoDirectory(fullPath);

        if (fullNode.exists) {
            return new FileSystemDirectoryHandle(name, fullPath);
        }

        const fileNode = new ExpoFile(this.path + name);
        if (fileNode.exists) {
            throw new DOMException(`A file with the same name exists: ${name}`, 'TypeMismatchError');
        }

        if (options?.create) {
            fullNode.create();
            return new FileSystemDirectoryHandle(name, fullPath);
        }

        throw new DOMException('A requested file or directory could not be found at the time an operation was processed.', 'NotFoundError');
    }

    async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
        if (!isValidName(name)) throw new TypeError(`Name is not allowed: ${name}`);
        const fullPath = this.path + name;

        if (accessHandles.has(fullPath) || openWritableStreams.has(fullPath)) {
            throw new DOMException('The object can not be modified in this way.', 'NoModificationAllowedError');
        }

        const fileNode = new ExpoFile(fullPath);
        if (fileNode.exists) {
            fileNode.delete();
            accessHandles.delete(fullPath);
            openWritableStreams.delete(fullPath);
            return;
        }

        const dirNode = new ExpoDirectory(fullPath + '/');
        if (!dirNode.exists) {
            throw new DOMException('A requested file or directory could not be found at the time an operation was processed.', 'NotFoundError');
        }

        if (options?.recursive) {
            for (const lockedPath of accessHandles) {
                if (lockedPath.startsWith(fullPath + '/')) {
                    throw new DOMException('The object can not be modified in this way.', 'NoModificationAllowedError');
                }
            }
            for (const lockedPath of openWritableStreams.keys()) {
                if (lockedPath.startsWith(fullPath + '/')) {
                    throw new DOMException('The object can not be modified in this way.', 'NoModificationAllowedError');
                }
            }
        } else {
            const contents = dirNode.list();
            if (contents.length > 0) {
                throw new DOMException('The object can not be modified in this way.', 'InvalidModificationError');
            }
        }

        dirNode.delete();
        accessHandles.delete(fullPath);
        openWritableStreams.delete(fullPath);
    }

    async resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null> {
        const descendantPath = (possibleDescendant as any).path;
        if (!descendantPath.startsWith(this.path)) return null;
        if (descendantPath === this.path) return [];

        let relative = descendantPath.substring(this.path.length);
        if (relative.endsWith('/')) {
            relative = relative.slice(0, -1);
        }
        return relative.split('/');
    }

    async *keys(): AsyncIterableIterator<string> {
        const entries = this.dirNode.list();
        for (const entry of entries) {
            if (entry.name === '.keep') continue;
            yield entry.name;
        }
    }

    async *values(): AsyncIterableIterator<FileSystemHandle> {
        const entries = this.dirNode.list();
        for (const entry of entries) {
            if (entry.name === '.keep') continue;

            // Expo entries represent themselves via type logic or we create handles dynamically
            if (entry instanceof ExpoDirectory || (entry as any).isDirectory) {
                yield new FileSystemDirectoryHandle(entry.name, entry.uri + '/');
            } else {
                yield new FileSystemFileHandle(entry.name, entry.uri);
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
        if (!OPFS_ROOT.exists) {
            OPFS_ROOT.create();
        }
        return new FileSystemDirectoryHandle('', OPFS_ROOT.uri);
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
