import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from 'vite';
import { createRequire } from 'node:module';

// Resolve through the actual dev configuration: every NYC-Tron entry the
// preview renders must reach the package's browser build and export the
// component the Studio contract maps to it.
const config = await resolveConfig({ configFile: fileURLToPath(new URL('./vite.config.ts', import.meta.url)), logLevel: 'silent' }, 'serve');
const resolveId = config.createResolver();
const main = fileURLToPath(new URL('./src/main.tsx', import.meta.url));
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');

async function exportNames(entry) {
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, metafile: true,
    format: 'esm', platform: 'browser', logLevel: 'silent',
    plugins: [{ name: 'external-peers', setup(builder) {
      builder.onResolve({ filter: /^[^./]|^@/ }, args => args.kind === 'entry-point' || args.path.startsWith('/') ? undefined : { path: args.path, external: true });
    } }],
  });
  return new Set(Object.values(result.metafile.outputs).flatMap(output => output.exports));
}

const expected = {
  '@nyc-tron/ui/components/Button': ['Button'], '@nyc-tron/ui/components/Card': ['Card'],
  '@nyc-tron/ui/components/SegmentedControl': ['SegmentedControl'], '@nyc-tron/ui/components/TabBar': ['TabBar'],
  '@nyc-tron/ui/components/Toolbar': ['Toolbar'], '@nyc-tron/ui/components/List': ['List', 'ListItem'],
  '@nyc-tron/ui/components/IconButton': ['IconButton'], '@nyc-tron/ui/components/FieldGroup': ['FieldGroup'],
  '@nyc-tron/ui/components/feedback/Banner': ['Banner'], '@nyc-tron/ui/components/feedback/Badge': ['Badge'],
  '@nyc-tron/ui/components/feedback/EmptyState': ['EmptyState'], '@nyc-tron/ui/components/feedback/ErrorMessage': ['ErrorMessage'],
  '@nyc-tron/ui/components/content/KeyValueList': ['KeyValueList'], '@nyc-tron/ui/components/theme/NightScope': ['NightScope'],
  '@nyc-tron/ui/components/files/DropZone': ['DropZone'], '@nyc-tron/ui/components/files/FilePicker': ['FilePicker'],
  '@nyc-tron/ui/components/html': ['Page', 'Main', 'Nav', 'Header', 'Footer', 'Section', 'Heading', 'Paragraph', 'Link', 'Text'],
  '@nyc-tron/expo-controls/Select': ['Select'], '@nyc-tron/expo-controls/NativeActionMenu': ['NativeActionMenu'],
};
let count = 0;
for (const [id, names] of Object.entries(expected)) {
  const entry = await resolveId(id, main);
  assert.ok(entry, `${id} must resolve from the preview`);
  // Web builds only: a .native file here would pull Expo's SwiftUI/Compose views into the browser.
  assert.doesNotMatch(entry, /\.native\.js$/, `${id} resolved to a native build: ${entry}`);
  const exports = await exportNames(entry);
  for (const name of names) { assert.ok(exports.has(name), `${id} must export ${name}`); count++; }
}
console.log(`NYC-Tron web entries verified (${Object.keys(expected).length} modules, ${count} exports)`);
