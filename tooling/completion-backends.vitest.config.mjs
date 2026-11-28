import {fileURLToPath} from 'node:url';
import {sourceResolve} from './source-condition.mjs';

// These source tests resolve the same entry point as the declared workspace dependency,
// read from src/ through the @nitro-forge/source export condition.
// They exercise real CLI engines; they do not replace installed/native consumer validation.
export default {
 ...sourceResolve,
 root:fileURLToPath(new URL('../',import.meta.url)),
 test:{environment:'node',include:[
  'packages/photo/tests/**/*.test.ts',
  'packages/motion/tests/**/*.test.ts',
  'packages/design/tests/**/*.test.ts',
  'packages/draft/tests/**/*.test.ts',
  'packages/scene/tests/**/*.test.ts',
  'packages/ignition/tests/photo-motion-pipeline.test.ts',
 ]},
};
