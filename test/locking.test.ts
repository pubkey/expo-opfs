import { beforeEach, describe, expect, test } from './harness';

describe('OPFS Error usage tests 2', () => {
  test('createSyncAccessHandle while createWritable is active', async () => {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle('lock2.txt', { create: true });

    const stream1 = await fileHandle.createWritable();

    let error: Error | undefined;
    try {
      if (typeof (fileHandle as any).createSyncAccessHandle === 'function') {
        await (fileHandle as any).createSyncAccessHandle();
      }
    } catch (e: any) {
      error = e;
    }

    expect(error).toBeDefined();
    expect(error?.name).toBe('NoModificationAllowedError');

    await stream1.close();
  });

  test('operations on closed SyncAccessHandle', async () => {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle('lock3.txt', { create: true });

    if (typeof (fileHandle as any).createSyncAccessHandle !== 'function') return;

    const accessHandle = await (fileHandle as any).createSyncAccessHandle();
    accessHandle.close();

    let error: Error | undefined;
    try {
      accessHandle.getSize();
    } catch (e: any) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error?.name).toBe('InvalidStateError');
  });
});
