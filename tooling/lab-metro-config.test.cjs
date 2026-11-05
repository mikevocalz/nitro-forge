const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const app of ['forge-audio-lab', 'forge-media-lab']) {
  test(`${app} keeps workspace assets visible without losing Expo or Uniwind configuration`, () => {
    const project = path.resolve(__dirname, '../apps', app);
    const workspace = path.resolve(project, '../..');
    const resolver = { marker: 'expo-resolver' };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(project, 'metro.config.js'), 'utf8'), {
      __dirname: project, module,
      require(name) {
        if (name === 'node:path') return path;
        if (name === 'expo/metro-config') return { getDefaultConfig: () => ({ watchFolders: ['/expo-existing'], resolver }) };
        if (name === 'uniwind/metro') return { withUniwindConfig: (config, uniwind) => ({ ...config, uniwind }) };
        throw new Error(`Unexpected dependency ${name}`);
      },
    });
    const config = module.exports;
    assert.ok(config.watchFolders.includes(workspace), 'pnpm assets outside the app must be watched');
    assert.ok(config.watchFolders.includes('/expo-existing'), 'Expo watch folders must survive');
    assert.equal(config.resolver, resolver);
    assert.equal(config.uniwind.cssEntryFile, './global.css');
  });
}
