// Mock implementation of expo-file-system for JSDOM testing
export const documentDirectory = 'file:///test-doc-dir/';

export const EncodingType = {
    Base64: 'base64',
    Utf8: 'utf8'
};

const _memFs = new Map();

export async function getInfoAsync(path) {
    if (_memFs.has(path)) {
        const isDir = typeof _memFs.get(path) === 'object';
        return { exists: true, isDirectory: isDir };
    }
    return { exists: false };
}

export async function readAsStringAsync(path) {
    if (!_memFs.has(path)) throw new Error('File not found');
    if (typeof _memFs.get(path) === 'object') throw new Error('Is a directory');
    return _memFs.get(path); // Mock returns plain string or base64 directly
}

export async function writeAsStringAsync(path, content) {
    _memFs.set(path, content);
}

export async function makeDirectoryAsync(path) {
    _memFs.set(path, {});
}

export async function deleteAsync(path) {
    _memFs.delete(path);
    // Mimic recursive deletion for directories
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
