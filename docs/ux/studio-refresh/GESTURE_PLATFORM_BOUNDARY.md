# Shared Studio input boundary

Studio keeps one set of canvas, docking and layer-order controllers. The host
selects the input transport, not a second document model:

- Native: `studio-gesture.native.tsx` uses Gesture Handler's declarative
  `Gesture.Race(Pan, Tap)` and `GestureDetector`. `apps/example/app/_layout.tsx` wraps the
  navigator and Studio provider in a flex-1 `GestureHandlerRootView`.
- Browser: `studio-gesture.tsx` retains the existing RNWeb pointer/responder
  behavior and page coordinates, including scroll-offset correction in Prism.
- Both expose the same `StudioGestureProps` and render the original provider
  child without an extra layout wrapper. Explicit controls remain available
  for keyboard and accessibility operation.

The native transport runs callbacks on JS deliberately: existing controllers
perform asynchronous native measurements, React preview updates, and engine
commands. UI-thread recognition does not make those callbacks worklets. A
successful finalize must not cancel release's in-flight remeasurement. A
no-movement tap has an explicit recognizer; a losing pan cannot cancel the
winning tap's pending release. Failed
recognition, interruption and extra pointers cancel without engine commits.

The current example targets Expo58/RN0.88 with Gesture Handler 3.4.0. This
deliberately follows the requested latest release rather than Expo58's bundled
~3.3 range; native build/device compatibility still needs runtime validation. Native hosts must
install their compatible Gesture Handler dependency and provide a root view.
Android modal contents require their own gesture root where applicable.

Meta VR is a target for this shared contract, not a verified runtime. An Android
XR host must validate its pointer/ray-to-view input path and device accessibility;
no headset, controller, hand-tracking or native engine test has run here.

Skia rendering remains a separate host concern. The input adapter does not
replace the Rust renderer, create a second document store, or pretend that
native Skia initialization provides browser CanvasKit initialization. New
shared GPU surfaces must use the same reusable drawing component behind each
host's supported Skia runtime/bootstrap and preserve the engine command API.

## Verification

`node --experimental-strip-types --test packages/studio-workspace/src/*.test.ts`
includes native transport callback tests (transpiled actual adapter), root
nesting, delayed release, cancellation, repeated gestures and geometry checks.
These are unit/static checks, not native device or headset execution.

References:
- https://docs.swmansion.com/react-native-gesture-handler/docs/fundamentals/getting-started/
- https://wcandillon.github.io/react-native-skia/docs/getting-started/migration/

## Latest host compatibility

Gesture Handler 3.4 retains the builder API used here. Its exported detector
recognizes `BaseGesture`/`ComposedGesture` and delegates to the legacy detector,
preserving the adapter's no-extra-layout-wrapper contract. Moving to the new
`usePanGesture`/`useTapGesture` hooks is not a mechanical rename: the v3 native
detector introduces a host view, callbacks use `canceled`, and composition uses
`useCompetingGestures`. A hook migration must verify layout and gesture ownership
on native devices rather than silently change this boundary.

RN0.88's View is a function component: measured refs use
`ComponentRef<typeof View>`, not the component's function type. Escape handling
normalizes browser `event.key` and native `event.nativeEvent.key`. Gesture
callback tests transpile with esbuild rather than TypeScript's removed compiler
API in TypeScript 7.

Reference: https://docs.swmansion.com/react-native-gesture-handler/docs/guides/upgrading-to-3/
