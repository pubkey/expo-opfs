const fs = require('fs');
const path = require('path');

const packageJson = require('../package.json');
const version = packageJson.version;

const versionFilePath = path.join(__dirname, '..', 'src', 'version.ts');
fs.writeFileSync(versionFilePath, `export const EXPO_OPFS_VERSION = '${version}';\n`, 'utf8');
console.log(`Wrote src/version.ts with EXPO_OPFS_VERSION = '${version}'`);
