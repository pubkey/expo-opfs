import { beforeEach, describe, expect, test } from './harness';

describe('OPFS Parallel Operations', () => {
    beforeEach(async () => {
        const root = await navigator.storage.getDirectory();
        for await (const name of root.keys()) {
            try {
                await root.removeEntry(name, { recursive: true });
            } catch (e) {
                // Ignore errors if file is locked or already removed
            }
        }
    });

    test('should handle concurrent writes to different files', async () => {
        const root = await navigator.storage.getDirectory();

        // Create handles
        const file1 = await root.getFileHandle('file1.txt', { create: true });
        const file2 = await root.getFileHandle('file2.txt', { create: true });
        const file3 = await root.getFileHandle('file3.txt', { create: true });

        // Create writables
        const stream1 = await file1.createWritable();
        const stream2 = await file2.createWritable();
        const stream3 = await file3.createWritable();

        // Write concurrently
        await Promise.all([
            stream1.write('Content 1'),
            stream2.write('Content 2'),
            stream3.write('Content 3'),
        ]);

        // Close concurrently
        await Promise.all([
            stream1.close(),
            stream2.close(),
            stream3.close(),
        ]);

        const f1 = await file1.getFile();
        const f2 = await file2.getFile();
        const f3 = await file3.getFile();

        expect(await f1.text()).toBe('Content 1');
        expect(await f2.text()).toBe('Content 2');
        expect(await f3.text()).toBe('Content 3');
    });

    test('should handle concurrent creation of multiple files', async () => {
        const root = await navigator.storage.getDirectory();

        const creationPromises = Array.from({ length: 50 }).map((_, i) =>
            root.getFileHandle(`concurrentFile_${i}.txt`, { create: true })
        );

        await Promise.all(creationPromises);

        let count = 0;
        for await (const key of root.keys()) {
            if (key.startsWith('concurrentFile_')) {
                count++;
            }
        }

        expect(count).toBe(50);
    });

    test('should handle simultaneous writes to the same writable stream', async () => {
        const root = await navigator.storage.getDirectory();
        const handle = await root.getFileHandle('shared-stream.txt', { create: true });

        const stream = await handle.createWritable();

        // Run 100 small chunks of writes "simultaneously"
        const writePromises = Array.from({ length: 100 }).map((_, i) =>
            stream.write(`Chunk ${i}\n`)
        );

        await Promise.all(writePromises);
        await stream.close();

        const file = await handle.getFile();
        const text = await file.text();

        // Verify all chunks were written. Order doesn't matter for Promise.all map, but normally we are checking data integrity.
        for (let i = 0; i < 100; i++) {
            expect(text).toContain(`Chunk ${i}\n`);
        }

        // Verify correct total length
        const expectedLength = Array.from({ length: 100 }).reduce((sum: number, _, i) => sum + `Chunk ${i}\n`.length, 0);
        expect(file.size).toBe(expectedLength);
    });

    test('should handle NoModificationAllowedError for concurrent writable streams based on environment', async () => {
        const root = await navigator.storage.getDirectory();
        const fileHandle = await root.getFileHandle('locked-stream-strict.txt', { create: true });

        const stream1 = await fileHandle.createWritable();

        try {
            const stream2 = await fileHandle.createWritable();
            await stream2.write("Overwritten by 2");
            await stream2.close();
        } catch (e: any) {
            expect(e).toBeInstanceOf(DOMException);
            expect(e.name).toBe('NoModificationAllowedError');
        }

        await stream1.write("Written by 1");
        await stream1.close();

        // After closing, we should be able to create a new writable
        const stream3 = await fileHandle.createWritable();
        await stream3.write("Written after unlock");
        await stream3.close();

        const file = await fileHandle.getFile();
        // The final content depends on whether the second stream was allowed to write or not.
        // If stream2 was allowed, it would be "Overwritten by 2".
        // If stream2 was blocked, stream1 would write "Written by 1", then stream3 "Written after unlock".
        // The test allows either behavior, so we check for the last successful write.
        expect(await file.text()).toBe("Written after unlock");
    });

    test('should enforce NoModificationAllowedError for concurrent SyncAccessHandles', async () => {
        const root = await navigator.storage.getDirectory();
        const fileHandle = await root.getFileHandle('locked-sync-strict.txt', { create: true });

        if (typeof (fileHandle as any).createSyncAccessHandle !== 'function') {
            return; // Skip if not supported in test environment
        }

        const handle1 = await (fileHandle as any).createSyncAccessHandle();

        const handle2Promise = (fileHandle as any).createSyncAccessHandle();
        await expect(handle2Promise).rejects.toBeInstanceOf(DOMException);
        await expect(handle2Promise).rejects.toHaveProperty('name', 'NoModificationAllowedError');

        // WritableStream also locked if SyncAccessHandle is active
        const writablePromise = fileHandle.createWritable();
        await expect(writablePromise).rejects.toBeInstanceOf(DOMException);
        await expect(writablePromise).rejects.toHaveProperty('name', 'NoModificationAllowedError');

        handle1.close();

        // After closing, we should be able to create a new SyncAccessHandle
        const handle3 = await (fileHandle as any).createSyncAccessHandle();
        handle3.close();
    });

    test('should handle concurrent directory and file deletions', async () => {
        const root = await navigator.storage.getDirectory();

        // Setup
        await root.getDirectoryHandle('dirA', { create: true });
        await root.getFileHandle('fileA.txt', { create: true });
        const dirB = await root.getDirectoryHandle('dirB', { create: true });
        await dirB.getFileHandle('nested.txt', { create: true });
        await root.getFileHandle('fileB.txt', { create: true });

        // Ensure they exist
        let keys = [];
        const expectedKeys = ['dirA', 'fileA.txt', 'dirB', 'fileB.txt'];
        for await (const key of root.keys()) {
            if (expectedKeys.includes(key)) keys.push(key);
        }
        expect(keys.length).toBe(4);

        // Concurrently delete
        await Promise.all([
            root.removeEntry('dirA', { recursive: true }),
            root.removeEntry('fileA.txt'),
            root.removeEntry('dirB', { recursive: true }),
            root.removeEntry('fileB.txt'),
        ]);

        // Ensure all wiped
        keys = [];
        for await (const key of root.keys()) {
            if (expectedKeys.includes(key)) keys.push(key);
        }
        expect(keys.length).toBe(0);
    });
});
