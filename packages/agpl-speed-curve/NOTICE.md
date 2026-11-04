# Provenance and license — Forge experimental speed curve

SPDX-License-Identifier: AGPL-3.0-or-later

The speed-curve behavior and formulae in this prototype were adapted from
[CapCraft Android](https://github.com/artcraft-android/capcraft-android),
under AGPL-3.0-or-later.

Upstream path: `src/crates/capcraft-android/android/app/src/main/java/io/github/artcraftandroid/capcraft/ui/editor/panels/SpeedCurveEditor.kt`
Upstream blob: `efbac2efebb02b9a3243e51acfcab9257410ac3b`.
Upstream notice: Copyright (c) 2026 ArtCraft Team and the CapCraft contributors.
Upstream also credits Concat engine contributors under AGPL-3.0-or-later.

Changes made by Nitro Forge, November 3, 2026:
- Ported the speed curve's logarithmic scale and trapezoidal average behavior into
  a validated cross-platform TS interface and native Swift/Kotlin method service.
- Added bounded input validation and a sampled preview output interface.
- November 4, 2026: documented `at` as output (timeline) position, matching
  upstream `meanOf` and its playhead-based point placement.
- No upstream Compose UI, music/audio/media assets or icon files are copied.
- Original UI, full retime engine integration, and direct manipulable view remain unbuilt.

Upstream NOTICE: https://github.com/artcraft-android/capcraft-android/blob/main/NOTICE
Upstream third-party notices: https://github.com/artcraft-android/capcraft-android/blob/main/THIRD_PARTY_NOTICES.md

This copy and adaptations retain the AGPL-3.0-or-later license. They may
impose source availability obligations on combined distributed works.
A Nitro/Expo bridge alone does not make the resulting combination proprietary.
Experimental package: not linked into any shipped Forge app.
