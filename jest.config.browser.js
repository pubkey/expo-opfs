module.exports = {
    preset: 'jest-expo/web',
    transform: {
        '^.+\\.(js|jsx|ts|tsx|mjs)$': 'babel-jest',
    },
    transformIgnorePatterns: [
        'node_modules/(?!(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|expo-file-system|expo-modules-core|uuid)'
    ],
    moduleNameMapper: {
        '^expo-file-system$': '<rootDir>/test/mock-fs.js',
        '^expo-file-system/legacy$': '<rootDir>/test/mock-fs.js'
    },
    setupFilesAfterEnv: ['<rootDir>/jest.setup.browser.js']
};
