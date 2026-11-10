import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
export default defineConfig({resolve:{alias:{'@nitro-forge/ignition':fileURLToPath(new URL('../ignition/src/index.ts',import.meta.url))}},test:{include:['packages/photo/tests/**/*.test.ts']}});
