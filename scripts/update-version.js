const fs = require('fs');
const path = require('path');

const packageJson = require('../package.json');
const version = packageJson.version;

const indexPath = path.join(__dirname, '..', 'src', 'index.ts');
let content = fs.readFileSync(indexPath, 'utf8');

const pattern = /export const EXPO_OPFS_VERSION = ['"][^'"]*['"];/;
if (!pattern.test(content)) {
    console.error('Could not find EXPO_OPFS_VERSION in src/index.ts');
    process.exit(1);
}

content = content.replace(
    pattern,
    `export const EXPO_OPFS_VERSION = '${version}';`
);

fs.writeFileSync(indexPath, content, 'utf8');
console.log(`Updated EXPO_OPFS_VERSION to '${version}'`);
