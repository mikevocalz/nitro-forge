import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Read-only prerequisite probe. Inputs are extracted official npm packages or
// upstream source trees, not guessed device capability. A pass is NOT playback.
const [videoRoot, coreRoot] = process.argv.slice(2);
if (!videoRoot || !coreRoot) {
  console.error('Usage: node scripts/check-video-v1-contract.mjs <react-native-video package> <nitro-core package>');
  process.exit(2);
}
const read = (root, file) => readFileSync(resolve(root, file), 'utf8');
const video = JSON.parse(read(videoRoot, 'package.json'));
const core = JSON.parse(read(coreRoot, 'package.json'));
const factory = read(videoRoot, 'src/core/utils/playerFactory.ts');
const proxy = read(coreRoot, 'js/src/NitroModulesProxy.ts');
console.log(`Checking ${video.name}@${video.version} against ${core.name}@${core.version}`);
if (/NitroModules\.createHybridObject/.test(factory) && !/\bcreateHybridObject\s*[<(]/.test(proxy)) {
  console.error('BLOCKED: the video native factory requires createHybridObject, absent from this Nitro v1 proxy. Port factory/specs/native bindings; do not downgrade Nitro or substitute Expo Video.');
  process.exit(1);
}
console.log('Factory API prerequisite passed. Native generation, compile/link and device tests are still required.');
