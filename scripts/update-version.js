const fs = require('fs');
const path = require('path');

const packageJson = require('../package.json');
const version = packageJson.version;

const indexPath = path.join(__dirname, '..', 'src', 'index.ts');
let content = fs.readFileSync(indexPath, 'utf8');

content = content.replace(
    /export const EXPO_OPFS_VERSION = '[^']*';/,
    `export const EXPO_OPFS_VERSION = '${version}';`
);

fs.writeFileSync(indexPath, content, 'utf8');
console.log(`Updated EXPO_OPFS_VERSION to '${version}'`);
