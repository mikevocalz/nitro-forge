# @nitro-forge/agpl-speed-curve

Experimental **AGPL-3.0-or-later** source-derived API for normalized speed-curve
control and preview. Original behavior is adapted from
[CapCraft Android](https://github.com/artcraft-android/capcraft-android).
See [LICENSE](./LICENSE) and [NOTICE.md](./NOTICE.md).

**Source-only prototype, not included in the shipped Studio or example.**

```ts
import {
  speedToPosition, meanSpeed, sampleSpeeds, nativeSampleSpeeds,
} from "@nitro-forge/agpl-speed-curve";

const curve = [{ at: 0, speed: 1 }, { at: 0.5, speed: 3 }, { at: 1, speed: 1 }];
const y = speedToPosition(3);
const average = meanSpeed(curve);
const preview = sampleSpeeds(curve, 256);
const nativePreview = await nativeSampleSpeeds(curve, 256); // Expo 58 dev build only
```

Swift and Kotlin use **Expo Modules v2** annotated asynchronous methods with
matching validation and sample generation. These are batch methods:
do not bridge to native on every scrub gesture. Use Skia v3 / UI-thread math
for direct manipulation, and Splice Rust/Nitro v1 for authoritative curve
editing/undo once that engine operation is implemented.

**Not yet done:** native build, autolink test, device parity, actual native
speed-curve view, frame-exact retiming, media export. iOS/Android source
presence is not evidence of device support.

**Distribution:** Expo/Nitro bridging does not waive AGPL. Distributing a
linked combined work may require AGPL licensing and corresponding source for
the combined work. Keep this package opt-in and out of proprietary consumers
pending license review. It can be sold as open-source AGPL software.
