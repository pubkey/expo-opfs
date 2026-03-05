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

    test('should isolate locked writable streams for the same file', async () => {
        const root = await navigator.storage.getDirectory();
        const fileHandle = await root.getFileHandle('locked-stream.txt', { create: true });

        // Attempting to create a second writable while one is open explicitly throws NoModificationAllowedError per Spec.
        // We will verify if our Polyfill enforces this lock or simulates it safely yet.

        const stream1 = await fileHandle.createWritable();

        // Many polyfills fail this native browser lock, let's see what ours does. If ours allows it, we test the overwrite outcome.
        try {
            const stream2 = await fileHandle.createWritable();
            await stream2.write("Overwritten by 2");
            await stream2.close();
        } catch (e: any) {
            // If we throw, that is spec-compliant native behavior (NoModificationAllowedError)
            expect(e).toBeInstanceOf(Error);
        }

        await stream1.write("Written by 1");
        await stream1.close();

        const file = await fileHandle.getFile();
        const text = await file.text();

        // If stream2 succeeded, stream1's close() will clobber stream2's data. 
        // If stream2 failed, stream1 is the sole writer.
        expect(text).toBe("Written by 1");
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
