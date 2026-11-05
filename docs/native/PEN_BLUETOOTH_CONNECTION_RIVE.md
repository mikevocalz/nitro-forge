# Forge Pen Bluetooth + Rive connection experience

Status: DRAFT. Android BLE GATT and dialog source exists; native app builds, physical hardware and Rive CLI animation playback NOT VERIFIED.

## Decisions and source of truth

The existing Muse/Viro Vision Pro bridge (Forge PR #15) remains the ONLY Logitech Muse input source on visionOS. Logitech Muse pairing is system-owned: hold Muse top and primary buttons for 3 seconds, then open Apple Vision Pro Settings > Bluetooth and pair. A Viro native spatial-stylus tracking event is required before Forge reports READY.

On Android, the new first-party Nitro v1 BLE package requests user permission through React Native PermissionsAndroid, discovers nearby actual BLE devices and connects only to a selected scanned device. Kotlin uses Android BluetoothLeScanner and BluetoothGattCallback. GATT connected means only a Bluetooth link, NOT a Muse pressure/6DoF protocol. Muse on Quest/PICO/Android XR is NOT implemented or verified.

Munum/munim-bluetooth 0.10.2 and react-native-ble-nitro are useful upstream API references, but use Nitro 0.x. Do not co-install these runtimes into the Nitro v1 alpha app. Forge owns this narrowly scoped v1 transport instead.

## Four stages of the UI

1. Native Connect pen dialog describes what the app needs.
2. Explicit Connect button triggers the OS Bluetooth permission popup, then scans and displays real discovered devices.
3. User selects a device; the app shows Bluetooth linked, awaiting native pen input only after actual GATT connection callback.
4. Only a trusted native Vision Pro spatial tracking sample or a separately verified vendor protocol can transition to READY, showing a green confirmation, optional Rive artboard and Start drawing.

There is no invented headset compatibility, fake spinner-to-success timeout, auto-connect, invented UUID, or unconsented device scan. Permission denial, disabled Bluetooth, errors, disconnects, stale scans and cancellation all remain explicit.

## Dialog: NYC-Tron DevicePairingDialog

Reusable UI lives in NYC-Tron (#38). `PenConnectionDialog` renders
`@nyc-tron/ui/components/forge/devices/DevicePairingDialog` from the
v0.1.0-alpha.2 release tarball, pinned in `tooling/nyc-tron.json` and checked by
`tooling/verify-nyc-tron-pin.mjs --download` against the release SHA256SUMS. The
controller stays in Forge; `src/pairing-state.ts` maps its states onto
NYC-Tron's `PairingState`:

| Controller | NYC-Tron | Why |
| --- | --- | --- |
| idle, explaining-permission | idle | |
| requesting-permission, scanning | scanning | No waiting-for-permission state; the scan follows the grant. |
| found | found | `rssi` becomes `signalDbm` only when finite (NYC-Tron throws on NaN). |
| connecting, linked | connecting | An unverified Bluetooth link never shows Connected. |
| system-pairing | connecting | Waiting for Viro tracking; see gaps. |
| ready | connected | The only success state. |
| error permission / disabled / connection | permission-denied / radio-off / connection-failed | NYC-Tron's own guidance copy. |
| error disconnected | connection-failed + controller message | |
| error scan / unsupported | unknown + controller message | |

Before a verified pen, the dialog's Close and Cancel both call
`controller.cancel()` and close; NYC-Tron labels Close "Cancel and close" and
gives both the same callback. Closing a verified pen is not a disconnect.
`apps/pen-connect-lab` renders every state on web with a fixture transport (no
Bluetooth) for review at phone and tablet widths in light and dark.

Gaps in NYC-Tron v0.1.0-alpha.2, recorded instead of keeping a Forge copy of
the dialog (DEFER until NYC-Tron adds them):

- Mode explanation: the idle copy is the generic "Turn on your pen and put it
  in pairing mode, then search." It no longer says that Connect asks for
  Bluetooth access (bluetooth-le), or that pairing happens in system
  Bluetooth Settings (system-spatial). `controller.mode` is kept but unused
  by the dialog. Needs an idle body or intro override in NYC-Tron.
- System-owned pairing: no state carries the visionOS pairing steps, so the
  instructions in `system-pairing` are not shown; the dialog shows
  "Connecting to Logitech Muse…" while it waits for tracking.
- Linked, unverified: shown as "Connecting to <pen>…". The old "Bluetooth
  linked, waiting for pen input" sentence has no NYC-Tron slot; the `linked`
  Rive artboard still plays through `renderAnimation`.
- Stop searching closes the dialog: NYC-Tron routes it and Close to the same
  `onCancel`.
- Live-region status is covered: the body is an Android/web live region and
  NYC-Tron announces each change on iOS.

## Rive CLI design

Source: assets/pen-connection/rive.yaml and scene.rml. Artboards: Searching, Pairing, Linked, Connected, Error. The PenConnectionDialog renderAnimation slot lets the app use its existing compatible Rive-native panels. The green Connected artboard is reserved for verified READY; an unverified GATT link shows amber Linked.

To verify and build with the official Rive CLI once installed:

    cd assets
    rive pen-connection --verify
    rive pen-connection

Rive CLI source and tests were authored, but CLI execution, binary .riv compilation, published asset, real-device view rendering and reduced-motion playback were NOT RUN. Without `renderAnimation`, NYC-Tron shows a spinner while busy and no art otherwise. Do not install a second Nitro 0.x Rive runtime in an app built against Nitro v1.

## Consumer wiring

- Vision Pro: createPenConnectionController(visionOSMusePort) and forward real Viro subscribeSpatialStylus input to verifyNativeInput({tracked:true,evidence:"visionos-spatial-stream"}).
- Android: call getForgeBluetooth(), createAndroidBlePenPort(new NativeBridge()), then createPenConnectionController(port). The native bridge must be linked with Nitro v1 codegen before running.
- The pen controller never owns QuickDraw edits. Feed real strokes through the existing BoardInputRouter; only one Muse subscription per board.

## Review roster

- [x] Controller with explicit connected vs ready states and cancellation.
- [x] Accessible native React Native modal, OS permission route, device list and error states.
- [x] First-party Android Nitro v1 BLE scanner/GATT connection source and teardown.
- [x] Rive CLI RML animation scene source.
- [ ] TypeScript/Vitest and Nitro v1 codegen CI results recorded and green.
- [ ] Android Gradle native build and actual Bluetooth permission dialog verified.
- [ ] Muse on Vision Pro headset connected and tracking verified.
- [ ] Rive CLI --verify, compiled asset and Rive playback on actual devices.
- [ ] Generic BLE pen service discovery, pressure protocol and haptics, if supported.
- [ ] Quest/PICO Muse direct transport AND 6DoF tracking before compatibility claim.

## Skill roster

Margelo pinned API design, build-nitro-modules, Swift, Kotlin, C++; Expo overview; Callstack RN performance; No AI Slop. Exact pinned roots match Forge PRs #8-#10:
https://github.com/margelo/react-native-skills/tree/main/skills
https://github.com/expo/skills
https://github.com/callstackincubator/agent-skills
https://github.com/petergyang/no-ai-slop

References:
https://support.apple.com/guide/apple-vision-pro/connect-spatial-accessories-tan7a3f2c9d3/visionos
https://rive.app/docs/cli/getting-started
https://github.com/munimtechnologies/munim-bluetooth
