import { File as ExpoFile, Directory as ExpoDirectory, Paths } from 'expo-file-system';
const OPFS_ROOT = new ExpoDirectory(Paths.document, '.expo-opfs');

if (typeof globalThis.DOMException === 'undefined') {
    (globalThis as any).DOMException = class DOMException extends Error {
        constructor(message?: string, name?: string) {
            super(message);
            this.name = name ?? 'DOMException';
        }
    };
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
    private fileNode: ExpoFile;

    constructor(name: string, path: string) {
        super('file', name, path);
        this.fileNode = new ExpoFile(path);
    }

    async getFile(): Promise<File> {
        let contentBytes: Uint8Array = new Uint8Array(0);
        try {
            contentBytes = await this.fileNode.bytes();
        } catch (e) {
            throw new DOMException('File could not be read', 'NotFoundError');
        }

        try {
            if (typeof File !== 'undefined') {
                return new File([contentBytes as any], this.name, { lastModified: Date.now() });
            }
            const b = new Blob([contentBytes as any]);
            (b as any).name = this.name;
            (b as any).lastModified = Date.now();
            return b as unknown as File;
        } catch (e: any) {
            // React Native's Blob constructor does not support ArrayBuffer/Uint8Array initialized blobs securely.
            // Creating a JS polyfilled File interface directly over the native bytes
            const b = contentBytes;
            return {
                name: this.name,
                lastModified: Date.now(),
                size: b.length,
                type: 'application/octet-stream',
                arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
                text: async () => new TextDecoder().decode(b),
                slice: (start?: number, end?: number, contentType?: string) => {
                    const sliced = b.slice(start ?? 0, end ?? b.length);
                    return {
                        name: this.name,
                        lastModified: Date.now(),
                        size: sliced.length,
                        type: contentType || '',
                        arrayBuffer: async () => sliced.buffer.slice(sliced.byteOffset, sliced.byteOffset + sliced.byteLength),
                        text: async () => new TextDecoder().decode(sliced)
                    } as any;
                },
                stream: () => {
                    if (typeof ReadableStream !== 'undefined') {
                        return new ReadableStream({
                            start(controller) {
                                controller.enqueue(b);
                                controller.close();
                            }
                        });
                    }
                    throw new Error('ReadableStream not supported');
                }
            } as unknown as File;
        }
    }

    async createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream> {
        let initialBytes: Uint8Array = new Uint8Array(0);
        if (options?.keepExistingData && this.fileNode.exists) {
            try {
                initialBytes = await this.fileNode.bytes();
            } catch (e) {
                // file doesn't exist or can't be read, start empty
            }
        } else if (this.fileNode.exists) {
            // Standard OPFS behavior: truncate file down to 0 bytes explicitly
            this.fileNode.delete();
            this.fileNode.create();
        } else {
            this.fileNode.create();
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

        const file = new ExpoFile(this.path);
        if (file.exists) file.delete();
        file.create();

        const openFile = file.open();
        openFile.writeBytes(this.buffer);
        openFile.close();

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
    private dirNode: ExpoDirectory;

    constructor(name: string, path: string) {
        super('directory', name, path);
        this.dirNode = new ExpoDirectory(path);
    }

    async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle> {
        const fullPath = this.path + name;
        const fileNode = new ExpoFile(fullPath);
        const dirNode = new ExpoDirectory(fullPath);

        if (dirNode.exists) {
            throw new DOMException(`A directory with the same name exists: ${name}`, 'TypeMismatchError');
        }

        if (fileNode.exists) {
            return new FileSystemFileHandle(name, fullPath);
        }

        if (options?.create) {
            fileNode.create();
            return new FileSystemFileHandle(name, fullPath);
        }

        throw new DOMException('A requested file or directory could not be found at the time an operation was processed.', 'NotFoundError');
    }

    async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle> {
        const fullPath = this.path + name + '/';
        const fullNode = new ExpoDirectory(fullPath);
        const fileNode = new ExpoFile(this.path + name);

        if (fileNode.exists) {
            throw new DOMException(`A file with the same name exists: ${name}`, 'TypeMismatchError');
        }

        if (fullNode.exists) {
            return new FileSystemDirectoryHandle(name, fullPath);
        }

        if (options?.create) {
            fullNode.create();
            return new FileSystemDirectoryHandle(name, fullPath);
        }

        throw new DOMException('A requested file or directory could not be found at the time an operation was processed.', 'NotFoundError');
    }

    async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
        const fullPath = this.path + name;
        const fileNode = new ExpoFile(fullPath);
        const dirNode = new ExpoDirectory(fullPath + '/');

        if (!fileNode.exists && !dirNode.exists) {
            throw new DOMException('A requested file or directory could not be found at the time an operation was processed.', 'NotFoundError');
        }

        if (dirNode.exists && !options?.recursive) {
            const contents = dirNode.list();
            if (contents.length > 0) {
                throw new DOMException('The object can not be modified in this way.', 'InvalidModificationError');
            }
        }

        const target = fileNode.exists ? fileNode : dirNode;
        target.delete();
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
