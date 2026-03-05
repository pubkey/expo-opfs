module.exports = {
    preset: 'jest-expo',
    moduleNameMapper: {
        '^expo-file-system$': '<rootDir>/test/mock-fs.js',
        '^expo-file-system/legacy$': '<rootDir>/test/mock-fs.js'
    },
    setupFilesAfterEnv: ['<rootDir>/jest.setup.expo.js']
};
