import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from 'vite';

// Resolve through the actual dev configuration. A production build alone can
// mask an ESM star-export of CommonJS whose named APIs fail in the browser.
const config = await resolveConfig({ configFile: fileURLToPath(new URL('./vite.config.ts', import.meta.url)), logLevel: 'silent' }, 'serve');
const entry = await config.createResolver()('@legendapp/motion', fileURLToPath(new URL('./src/main.tsx', import.meta.url)));
assert.ok(entry, 'Motion must resolve through the canonical source UI binding');
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vite/package.json'));
const { build } = viteRequire('esbuild');
async function exportNames(moduleEntry) {
const result = await build({
  entryPoints: [moduleEntry], bundle: true, write: false, metafile: true,
  format: 'esm', platform: 'browser', logLevel: 'silent', tsconfigRaw: { compilerOptions: {} },
  plugins: [{ name: 'external-ui-peers', setup(builder) {
    builder.onResolve({ filter: /^[^./]|^@/ }, args =>
      args.kind === 'entry-point' || args.path.startsWith('/') ? undefined : { path: args.path, external: true });
  } }],
});
return new Set(Object.values(result.metafile.outputs).flatMap(output => output.exports));

}
const exports = await exportNames(entry);
for (const name of ['Motion', 'AnimatePresence', 'createMotionComponent', 'createMotionAnimatedComponent']) {
  assert.ok(exports.has(name), `The resolved UI motion entry must statically export ${name}`);
}
const controlsEntry = await config.createResolver()('@acme/ui/studio-controls/web', fileURLToPath(new URL('./src/main.tsx', import.meta.url)));
assert.ok(controlsEntry, 'Canonical source-owned studio controls must resolve');
const controls = await exportNames(controlsEntry);
const required = ['Button', 'IconButton', 'Banner', 'Badge', 'EmptyState', 'KeyValueList', 'ErrorMessage', 'FieldGroup', 'Card', 'Toolbar', 'List', 'ListItem', 'NightScope', 'TabBar', 'SegmentedControl', 'Menu', 'Select', 'FilePicker'];
for (const name of required) assert.ok(controls.has(name), `Canonical studio controls must export ${name}`);
console.log(`Canonical UI exports verified (4 motion APIs, ${required.length} control APIs)`);

// Resolve the transitive Image peer from the external canonical UI tree too.
const imageEntry = await config.createResolver()('next/image', controlsEntry);
assert.equal(imageEntry, require.resolve('next/image'), 'Canonical Image must use the standalone host Next peer');
console.log('Canonical Image host peer resolution verified');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ImageModule = require(imageEntry);
const NextImage = ImageModule.default ?? ImageModule;
const png = '/canvas-preview.png';
const markup = renderToStaticMarkup(React.createElement(NextImage, {
  src: png, alt: 'Engine canvas preview', fill: true, unoptimized: true,
}));
assert.ok(markup.includes(`src="${png}"`), 'Engine PNG must retain its direct source');
assert.ok(!markup.includes('/_next/image'), 'Standalone preview has no Next optimizer service');
const optimized = renderToStaticMarkup(React.createElement(NextImage, { src: png, alt: '', fill: true }));
assert.ok(optimized.includes('/_next/image'), 'Ordinary PNG must exercise optimization unless explicitly disabled');
console.log('Standalone unoptimized canvas image render verified');
