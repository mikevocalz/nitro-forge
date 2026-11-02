# Isolated Expo 58 + Graphite Android build consumer

This is deliberately **NOT Moyo Learn**. It is a disposable Android app that
compiles and links the published Skia v3 Android native module against
React Native 0.88 and Expo SDK 58 without mixing in the app's existing v2
Skia or unreleased Nitro v1/0.x coexistence.

Runtime UI renders an augmented QuickDraw test stroke through the native
Graphite Canvas, with the same mandatory GPU fallback. Native pointer routing
is present, but its onPointer is deliberately a no-op: this smoke sample is a
*renderer* build test, not a second in-memory whiteboard editor.

Workflow: .github/workflows/board-skia-android-build.yml.
On green CI, only Android native **compile/link** is verified, NOT physical
rendering, input latency, text/images, real app persistence, Vision Pro/Metal,
or Viro texture import. A device session is still mandatory before rollout.
