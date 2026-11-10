const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { withNycTronDevLink } = require('./nyc-tron-metro.cjs');

test('candidate dev-link isolates selected packages and keeps native runtime resolution in the app', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-tron-link-'));
  try {
    const dir = path.join(root, 'packages/services'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@nyc-tron/platform-services',
      exports: { './checkpoints': { 'react-native': './native.js', default: './web.js' } } }));
    fs.writeFileSync(path.join(dir, 'native.js'), ''); fs.writeFileSync(path.join(dir, 'web.js'), '');
    const app = path.join(root, 'app');
    const context = { originModulePath: '/linked/source.js', resolveRequest: (ctx, name) => ({ origin: ctx.originModulePath, name }) };
    const config = withNycTronDevLink({ resolver: {}, watchFolders: ['/existing'] }, {
      projectRoot: app, nycTronRoot: root, includePackages: ['@nyc-tron/platform-services'],
    });
    const resolve = config.resolver.resolveRequest;
    assert.equal(resolve(context, '@nyc-tron/platform-services/checkpoints', 'ios').filePath, path.join(dir, 'native.js'));
    assert.equal(resolve(context, '@nyc-tron/platform-services/checkpoints', 'web').filePath, path.join(dir, 'web.js'));
    assert.equal(resolve(context, '@nyc-tron/ui/knob', 'ios').origin, '/linked/source.js');
    assert.equal(resolve(context, 'expo-file-system', 'ios').origin, path.join(app, 'package.json'));
    assert.equal(resolve(context, 'expo-modules-core', 'ios').origin, path.join(app, 'package.json'));
    assert.ok(config.watchFolders.includes('/existing'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

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
