import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vitest/config';

// Engine wiring tests only. A separate config keeps vitest from loading
// vite.config.ts, whose dev bridge and Skia asset plugins are for `vite dev`.
// NYC-Tron components and the editor controls that a test renders to markup
// import `react-native`. As in vite.config.ts, the app's own imports get React
// Native Web, and those of @nyc-tron and of @nitro-forge/editor-controls (served
// from source) go through the className binding (src/react-native-classname.tsx),
// so their class-based styling reaches the markup. Inlining @nyc-tron lets
// vitest run those imports through this resolver instead of Node's.
const rnw = createRequire(import.meta.url).resolve('react-native-web');
const shim = fileURLToPath(new URL('./src/react-native-classname.tsx', import.meta.url));

function nycTronClassName(): Plugin {
  return {
    name: 'nyc-tron-classname',
    enforce: 'pre',
    resolveId(source, importer) {
      const from = importer?.replaceAll('\\', '/') ?? '';
      if ((source === 'react-native' || source === rnw) && (from.includes('/@nyc-tron/') || from.includes('/packages/editor-controls/'))) return shim;
      return null;
    },
  };
}

export default defineConfig({
  plugins: [nycTronClassName()],
  resolve: { alias: [{ find: /^react-native$/, replacement: rnw }] },
  test: { include: ['tests/**/*.e2e.test.ts'], server: { deps: { inline: [/@nyc-tron\//] } } },
});
