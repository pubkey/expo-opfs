/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-require-imports */
export type TestFn = () => Promise<void> | void;
export type DescribeFn = () => void;
export type HookFn = () => Promise<void> | void;

export interface TestCase {
    name: string;
    fn: TestFn;
}

export interface TestSuite {
    name: string;
    beforeEachHooks: HookFn[];
    tests: TestCase[];
}

export const registeredSuites: TestSuite[] = [];
let currentSuite: TestSuite | null = null;

// Dual-Environment Describe
export function describe(name: string, fn: DescribeFn) {
    if (typeof (globalThis as any).describe === 'function') {
        return (globalThis as any).describe(name, fn);
    }
    if (typeof process !== 'undefined' && process.env.JEST_WORKER_ID !== undefined) {
        return require('@jest/globals').describe(name, fn);
    }
    currentSuite = { name, tests: [], beforeEachHooks: [] };
    registeredSuites.push(currentSuite);
    fn();
    currentSuite = null;
}

// Dual-Environment Test
export function test(name: string, fn: TestFn) {
    if (typeof (globalThis as any).test === 'function') {
        return (globalThis as any).test(name, fn);
    }
    if (typeof process !== 'undefined' && process.env.JEST_WORKER_ID !== undefined) {
        return require('@jest/globals').test(name, fn);
    }
    if (currentSuite) {
        currentSuite.tests.push({ name, fn });
    }
}

// Dual-Environment Hook
export function beforeEach(fn: HookFn) {
    if (typeof (globalThis as any).beforeEach === 'function') {
        return (globalThis as any).beforeEach(fn);
    }
    if (typeof process !== 'undefined' && process.env.JEST_WORKER_ID !== undefined) {
        return require('@jest/globals').beforeEach(fn);
    }
    if (currentSuite) {
        currentSuite.beforeEachHooks.push(fn);
    }
}

// Lightweight Custom Expect Harness matching Jest Syntax for App.tsx execution
export function expect(received: any) {
    if (typeof (globalThis as any).expect === 'function') {
        return (globalThis as any).expect(received);
    }
    if (typeof process !== 'undefined' && process.env.JEST_WORKER_ID !== undefined) {
        return require('@jest/globals').expect(received);
    }

    const assert = (condition: boolean, msg: string) => {
        if (!condition) throw new Error(`Assertion Error: ${msg}`);
    };

    const isMatch = (obj1: any, obj2: any): boolean => {
        if (obj1 === obj2) return true;
        if (typeof obj1 !== 'object' || typeof obj2 !== 'object' || obj1 == null || obj2 == null) return false;

        const keys1 = Object.keys(obj1);
        const keys2 = Object.keys(obj2);
        if (keys1.length !== keys2.length) return false;

        for (const key of keys1) {
            if (!keys2.includes(key) || !isMatch(obj1[key], obj2[key])) return false;
        }
        return true;
    };


    return {
        toBe(expected: any) {
            assert(received === expected, `Expected ${expected}, but got ${received}`);
        },
        toBeDefined() {
            assert(received !== undefined, 'Expected value to be defined');
        },
        toEqual(expected: any) {
            assert(isMatch(received, expected), `Expected structurally equivalent object, got mismatch.`);
        },
        toContain(expected: any) {
            const stringified = typeof received === 'string' ? received : String(received);
            assert(stringified.includes(String(expected)), `Expected value to contain ${expected}, but it did not`);
        },
        toContainEqual(expected: any) {
            let matched = false;
            for (const item of received) {
                if (isMatch(item, expected)) {
                    matched = true;
                    break;
                }
            }
            assert(matched, `Expected array to contain equal sub-object.`);
        },
        toBeInstanceOf(expected: any) {
            assert(received instanceof expected, `Expected instance of ${expected.name}`);
        },
        toBeUndefined() {
            assert(received === undefined, `Expected undefined, got ${received}`);
        },
        toBeNull() {
            assert(received === null, `Expected null, got ${received}`);
        },
        toBeGreaterThanOrEqual(expected: any) {
            assert(received >= expected, `Expected >= ${expected}, got ${received}`);
        },

        get resolves() {
            return {
                async toBeUndefined() {
                    const res = await received;
                    assert(res === undefined, `Expected promise to resolve to undefined, got ${res}`);
                }
            };
        },

        get rejects() {
            return {
                async toThrow(expectedError?: any) {
                    let thrown = false;
                    let err: any;
                    try {
                        await received;
                    } catch (e) {
                        thrown = true;
                        err = e;
                    }
                    assert(thrown, `Expected promise to reject, but it resolved successfully.`);
                    if (expectedError) {
                        const thrownDesc = String(err);
                        const expectedDesc = String(expectedError);
                        assert(thrownDesc.includes(expectedDesc) || (err instanceof expectedError), `Expected rejection to match ${expectedDesc}, got ${thrownDesc}`);
                    }
                },
                async toThrowError(expectedError?: any) {
                    return this.toThrow(expectedError);
                },
                async toBeInstanceOf(expectedError: any) {
                    let thrown = false;
                    let err: any;
                    try {
                        await received;
                    } catch (e) {
                        thrown = true;
                        err = e;
                    }
                    assert(thrown, `Expected promise to reject, but it resolved successfully.`);
                    if (expectedError) {
                        const isInstance = err instanceof expectedError || (err && err.name === expectedError.name);
                        assert(isInstance, `Expected rejection to be instance of ${expectedError.name}, got ${err}`);
                    }
                },
                async toHaveProperty(key: string, value: any) {
                    let thrown = false;
                    let err: any;
                    try {
                        await received;
                    } catch (e) {
                        thrown = true;
                        err = e;
                    }
                    assert(thrown, `Expected promise to reject, but it resolved successfully.`);
                    assert(err && err[key] === value, `Expected rejection to have property ${key} === ${value}, got ${err ? err[key] : undefined}`);
                }
            };
        }
    };
}
