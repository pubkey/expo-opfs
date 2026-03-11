import { beforeEach, describe, expect, test } from './harness';

const PERFORMANCE_ITERATIONS = 500;
const BATCH_SIZE = 1000;

describe('OPFS Performance', () => {
    beforeEach(async () => {
        const root = await navigator.storage.getDirectory();
        for await (const name of root.keys()) {
            try {
                await root.removeEntry(name, { recursive: true });
            } catch (e) {
                // ignore
            }
        }
    });

    test('Write Performance - sequential small writes', async () => {
        const root = await navigator.storage.getDirectory();
        const startTime = Date.now();

        for (let i = 0; i < PERFORMANCE_ITERATIONS; i++) {
            const fileHandle = await root.getFileHandle(`perf-write-${i}.txt`, { create: true });
            const writer = await fileHandle.createWritable();
            await writer.write(`Hello World ${i}`);
            await writer.close();
        }

        const duration = Date.now() - startTime;
        console.log(`[PERF] Sequential small writes (${PERFORMANCE_ITERATIONS} files): ${duration}ms`);
    });

    test('Read Performance - sequential reads', async () => {
        const root = await navigator.storage.getDirectory();

        // Setup
        for (let i = 0; i < PERFORMANCE_ITERATIONS; i++) {
            const fileHandle = await root.getFileHandle(`perf-read-${i}.txt`, { create: true });
            const writer = await fileHandle.createWritable();
            await writer.write(`Hello World ${i}`);
            await writer.close();
        }

        const startTime = Date.now();
        for (let i = 0; i < PERFORMANCE_ITERATIONS; i++) {
            const fileHandle = await root.getFileHandle(`perf-read-${i}.txt`);
            const file = await fileHandle.getFile();
            await file.text();
        }
        const duration = Date.now() - startTime;
        console.log(`[PERF] Sequential reads (${PERFORMANCE_ITERATIONS} files): ${duration}ms`);
    });

    test('Directory Operations - create and delete', async () => {
        const root = await navigator.storage.getDirectory();
        const startTime = Date.now();

        for (let i = 0; i < PERFORMANCE_ITERATIONS; i++) {
            await root.getDirectoryHandle(`perf-dir-${i}`, { create: true });
        }
        for (let i = 0; i < PERFORMANCE_ITERATIONS; i++) {
            await root.removeEntry(`perf-dir-${i}`);
        }

        const duration = Date.now() - startTime;
        console.log(`[PERF] Directory create/delete (${PERFORMANCE_ITERATIONS} ops): ${duration}ms`);
    });

    test('Random Access Writes - large file', async () => {
        const root = await navigator.storage.getDirectory();

        // Setup a 5MB "large" file
        const fileHandle = await root.getFileHandle(`perf-large-random.txt`, { create: true });
        let writer = await fileHandle.createWritable();
        const block = new Uint8Array(1024 * 1024 * 5); // 5MB
        await writer.write(block);
        await writer.close();

        // Now test time-to-first-byte and random seek/write
        const startTime = Date.now();
        for (let i = 0; i < 50; i++) {
            writer = await fileHandle.createWritable({ keepExistingData: true });
            await writer.write({ type: 'write', position: i * 1000, data: `Random ${i}` });
            await writer.close();
        }

        const duration = Date.now() - startTime;
        console.log(`[PERF] Random access writes (50 ops on 5MB file): ${duration}ms`);
    });

    test('Random Access Reads - large file slices', async () => {
        const root = await navigator.storage.getDirectory();

        // Setup a 5MB "large" file
        const fileHandle = await root.getFileHandle(`perf-large-read-random.txt`, { create: true });
        const writer = await fileHandle.createWritable();
        const block = new Uint8Array(1024 * 1024 * 5); // 5MB
        // Write some recognizable data at offset 2MB
        const targetString = "TARGET_DATA";
        const encoder = new TextEncoder();
        block.set(encoder.encode(targetString), 1024 * 1024 * 2);
        await writer.write(block);
        await writer.close();

        // Now test time-to-first-byte and random slice reads
        const startTime = Date.now();
        const file = await fileHandle.getFile(); // Should be instant (Lazy)

        for (let i = 0; i < PERFORMANCE_ITERATIONS; i++) {
            // Read a 100 byte chunk from 2MB offset
            const slice = file.slice(1024 * 1024 * 2, (1024 * 1024 * 2) + 100);
            await slice.text();
        }

        const duration = Date.now() - startTime;
        console.log(`[PERF] Random access reads (${PERFORMANCE_ITERATIONS} slice reads on 5MB file): ${duration}ms`);
    });

    test('SyncAccessHandle - bulk writes', async () => {
        const root = await navigator.storage.getDirectory();
        const fileHandle = await root.getFileHandle(`sync-perf.txt`, { create: true });

        if (typeof (fileHandle as any).createSyncAccessHandle !== 'function') return;

        const accessHandle = await (fileHandle as any).createSyncAccessHandle();

        const buffer = new TextEncoder().encode('Hello Bulk! ');

        const startTime = Date.now();
        for (let i = 0; i < BATCH_SIZE; i++) {
            // Append
            accessHandle.write(buffer, { at: i * buffer.byteLength });
        }
        accessHandle.flush();
        accessHandle.close();

        const duration = Date.now() - startTime;
        console.log(`[PERF] SyncAccessHandle writes (${BATCH_SIZE} ops): ${duration}ms`);
    });
});
