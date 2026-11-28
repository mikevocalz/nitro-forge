import { defineConfig } from 'vitest/config';
import { sourceResolve } from '../../tooling/source-condition.mjs';

// Engine wiring tests only. A separate config keeps vitest from loading
// vite.config.ts, whose dev bridge and Skia asset plugins are for `vite dev`.
// Workspace packages resolve from src/ through the @nitro-forge/source condition.
export default defineConfig({ ...sourceResolve, test: { include: ['tests/**/*.e2e.test.ts'] } });
