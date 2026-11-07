const fs = require('node:fs');
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const packed = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const files = new Set(packed[0].files.map((file) => file.path));
for (const path of [p.main, p.types, p['react-native'], p.source, 'Package.swift', 'nitrogen/generated/shared/javascript/VideoPlayer.cjs']) {
  if (!files.has(path.replace(/^\.\//, ''))) throw new Error(`Missing packed path: ${path}`);
}
if ([...files].some((path) => path.startsWith('lib/') && path.endsWith('/package.json'))) {
  throw new Error('Nested package scope hides #nitro imports');
}
console.log('PASS: packed entrypoints, generated runtime, SwiftPM manifest and import scope');
