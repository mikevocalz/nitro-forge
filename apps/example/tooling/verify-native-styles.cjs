// Real Uniwind -> Expo Metro transform, not a stylesheet-text-only assertion.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const util = require('node:util');
const root = path.resolve(__dirname, '..');
process.chdir(root);
const config = require('../metro.config.cjs');
assert.ok(config.transformerPath.includes('uniwind'));
assert.equal(config.transformer.uniwind.cssEntryFile, './global.css');
assert.equal(config.transformer.uniwind.polyfills.rem, 14);
const transformer = require(config.transformerPath);

(async () => {
  for (const platform of ['ios', 'android']) {
    const diagnostics = [];
    const originals = {};
    for (const level of ['log', 'warn', 'error']) {
      originals[level] = console[level];
      console[level] = (...args) => {
        diagnostics.push(util.format(...args));
        originals[level](...args);
      };
    }
    let result;
    try {
      result = await transformer.transform(config.transformer, root, 'global.css', fs.readFileSync(path.join(root, 'global.css')), {
        platform, dev: false, hot: false, minify: false, type: 'module',
        inlineRequires: false, experimentalImportSupport: false,
        unstable_transformProfile: 'default', customTransformOptions: {},
      });
    } finally {
      for (const level of Object.keys(originals)) console[level] = originals[level];
    }
    assert.equal(diagnostics.filter(line => /\bError\b|Invalid calc|cannot mix|can't mix/i.test(line)).length, 0,
      `${platform}: Uniwind diagnostics must not silently discard styles`);
    const output = result.output.find(entry => entry.type.startsWith('js/'));
    assert.ok(output, `${platform}: native CSS must become JS`);
    assert.equal(output.data.css?.code, '', `${platform}: no raw CSS in native bundle`);
    let factory;
    vm.runInNewContext(output.data.code, { __d: value => { factory = value; } });
    assert.equal(typeof factory, 'function');
    let registered;
    const uniwind = { Uniwind: { __reinit: (styles, themes) => { registered = { styles, themes }; } } };
    const dependencyMap = result.dependencies.map((dependency, index) => index);
    const module = { exports: {} };
    factory({}, () => uniwind, () => uniwind, () => uniwind, module, module.exports, dependencyMap);
    assert.ok(registered, `${platform}: real native registration must execute`);
    assert.deepEqual(Array.from(registered.themes), ['light', 'dark']);
    // Uniwind compiles theme variables separately from global vars. Its native
    // store overlays these lazy functions; inspect the exact registered scope.
    const styles = registered.styles({});
    for (const [theme, expected] of [['light', '#f4f5f8'], ['dark', '#1c1e25']]) {
      const scope = styles.scopedVars[`__uniwind-theme-${theme}`];
      assert.ok(scope, `${platform}/${theme}: registered theme scope`);
      assert.equal(scope['--color-forge-surface']({}), expected,
        `${platform}/${theme}: Forge base token`);
    }
    const property = (className, propertyName) => {
      const rules = styles.stylesheet[className];
      assert.ok(rules, `${platform}: ${className} class exists`);
      const entry = rules.flatMap(rule => rule.entries).find(([name]) => name === propertyName);
      assert.ok(entry, `${platform}: ${className} has ${propertyName}`);
      assert.equal(typeof entry[1], 'function');
      return entry[1](styles.vars);
    };
    assert.equal(property('rounded-sm', 'borderRadius'), 4,
      'canonical rounded-sm uses the shared 4px Studio radius');
    assert.equal(property('w-1/2', 'width'), '50%');
    assert.equal(property('pe-4', 'paddingEnd'), 14);
    assert.equal(property('ps-4', 'paddingStart'), 14);
    assert.equal(property('box-border', 'boxSizing'), 'border-box');
    console.log(`${platform}: native style registration, themes and radius passed without compiler errors`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
