import { defineConfig } from 'vitest/config';

// Engine wiring tests only. A separate config keeps vitest from loading
// vite.config.ts, whose dev bridge and Skia asset plugins are for `vite dev`.
export default defineConfig({ test: { include: ['tests/**/*.e2e.test.ts'] } });
