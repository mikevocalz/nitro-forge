import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

// Engine wiring tests only. A separate config keeps vitest from loading
// vite.config.ts, whose dev bridge and Skia asset plugins are for `vite dev`.
// NYC-Tron components that a test renders to markup import `react-native`;
// inlining the package lets the alias route that to React Native Web.
export default defineConfig({
  resolve: { alias: [{ find: /^react-native$/, replacement: createRequire(import.meta.url).resolve('react-native-web') }] },
  test: { include: ['tests/**/*.e2e.test.ts'], server: { deps: { inline: [/@nyc-tron\//] } } },
});
