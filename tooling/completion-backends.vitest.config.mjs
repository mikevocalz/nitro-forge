import {fileURLToPath} from 'node:url';

// These source tests resolve the same entry point as the declared workspace dependency.
// They exercise real CLI engines; they do not replace installed/native consumer validation.
export default {
 root:fileURLToPath(new URL('../',import.meta.url)),
 resolve:{alias:{'@nitro-forge/ignition':fileURLToPath(new URL('../packages/ignition/src/index.ts',import.meta.url))}},
 test:{environment:'node',include:[
  'packages/photo/tests/**/*.test.ts',
  'packages/motion/tests/**/*.test.ts',
  'packages/design/tests/**/*.test.ts',
  'packages/draft/tests/**/*.test.ts',
  'packages/scene/tests/**/*.test.ts',
  'packages/ignition/tests/photo-motion-pipeline.test.ts',
 ]},
};
