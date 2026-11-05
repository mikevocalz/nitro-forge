# Cadence: native editor session

## Scope of this change

A production-safe **command protocol** connecting the native SwiftUI and Compose \`ArcKnob\` controls in [NYC-Tron UI PR #8](https://github.com/mikevocalz/NYC-Tron-UI/pull/8) to an actual Cadence Rust document, through \`@nitro-forge/cadence/instrument-session\`.

The new \`CadenceInstrumentSession\` opens a typed Cadence document, creates a MIDI track, reads actual Rust \`describe()\` state, and binds gain/pan controls to **one** engine command per completed gesture. Every successful edit refreshes real engine values. Undo, redo, save, close, sequential writes, failure handling, and cleanup are exercised by Rust-backed Vitest with \`nf-cli\`. Source tests are not a substitute for a working on-device Nitro module.

### Public use

\`\`\`ts
import { createNitroHost } from "@nitro-forge/ignition";
import { CadenceInstrumentSession } from "@nitro-forge/cadence/instrument-session";

const session = await CadenceInstrumentSession.open(createNitroHost(), {
  trackName: "My synth",
});

const unsubscribe = session.subscribe(state => {
  // Render state.gain/state.pan in the real native SwiftUI or Compose controls.
});
await session.controls.gain.onCommit(0.6);
await session.undo();
unsubscribe();
await session.close();
\`\`\`

**Important:** \`createNitroHost()\` in the legacy Ignition package still needs the complete **Nitro v1 on-device module packaging** from the native FFI workstream (PRs #8–#10). Missing native modules MUST fail visibly. Do not show a fake document, quietly switch to Node CLI on a device, or label the mobile screen production-ready. The isolated v1 C++/Rust tests pass on Linux, but iOS/Android registration and runtime JS-to-HybridObject calls are not yet proved.

### Integration against NYC-Tron

- Real native \`@nyc-tron/native-controls/ArcKnob\`: \`minimum/maximum/step/value/onCommit/onError\`.
- Preview is local to SwiftUI/Compose; **do not persist onPreview**.
- A change is acknowledged only when \`CadenceInstrumentSession.setGain/setPan\` resolves after the Rust engine confirms and reports \`describe()\`.
- Display engine-reported values; never keep a duplicate audio document in Zustand.
- Use Zustand only for local view state (loading, pending, error and a snapshot of engine reads); do not use React \`useState\`.
- Do not connect the XYPad to two separate Rust operations until a genuinely atomic multi-property engine command exists.
- Source checkout: NYC-Tron PR #8 is draft/unpublished. Use a sibling source checkout for examples instead of inventing an npm release.
- Windows, macOS, iOS, Android, foldable and XR acceptance are independent gates.

Native references: official Expo SDK 58 \`expo-ui\`, \`expo-module\`, \`expo-migrate-module\` skills; Margelo \`api-design\`, \`build-nitro-modules\`, \`swift\`, \`kotlin\` skills. No external UI source is copied or relicensed in this PR.

### Acceptance

- [x] Real Rust (CLI) tests exercise commit => engine state => undo/redo => NFD1 save/reopen (CI must confirm).
- [ ] iOS and Android: native module generated and registered in the Expo 58 consumer, gain/pan onCommit reaches real Rust through Nitro v1.
- [ ] Real touch, stylus, VoiceOver/TalkBack, release/cancel behavior, 44-point hit area and disabled states.
- [ ] Surface Duo fold/unfold, orientation and multiple window sizes with selected track retained.
- [ ] Kinetrell native motion review and error recovery; no duplicate source of truth.
