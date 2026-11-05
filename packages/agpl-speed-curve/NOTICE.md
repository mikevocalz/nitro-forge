# Provenance and license — Forge experimental speed curve

SPDX-License-Identifier: AGPL-3.0-or-later

The speed-curve behavior and formulae in this prototype were adapted from
[CapCraft Android](https://github.com/artcraft-android/capcraft-android),
under AGPL-3.0-or-later.

Upstream path: `src/crates/capcraft-android/android/app/src/main/java/io/github/artcraftandroid/capcraft/ui/editor/panels/SpeedCurveEditor.kt`
Upstream commit: `5aee26b887ec2383acb9769714613b9691135f66` (2026-10-18), the last
commit touching that path; the file there is blob `efbac2efebb02b9a3243e51acfcab9257410ac3b`.
Upstream notice: Copyright (c) 2026 ArtCraft Team and the CapCraft contributors.
CapCraft is built on Concat, copyright Jareer Abdullah and the Concat contributors,
also AGPL-3.0-or-later. The adapted file is CapCraft app code, not Concat engine code.
The upstream top-level NOTICE at that commit is reproduced unmodified in
[UPSTREAM-NOTICE.txt](./UPSTREAM-NOTICE.txt). `LICENSE` is byte-identical to
upstream's `LICENSE` at that commit and on current `main` (the FSF AGPL-3.0 text).

That NOTICE mentions Concat's plugin exception (`LICENSE-EXCEPTIONS.md`). The
exception covers independent modules that talk to the Concat API; this package
is a port of CapCraft code, not such a module, so it relies on plain
AGPL-3.0-or-later only. Upstream `main` (31b4109) has since dropped the exception
file and the reference to it.

Changes made by Nitro Forge, November 3, 2026:
- Ported the speed curve's logarithmic scale and trapezoidal average behavior into
  a validated cross-platform TS interface and native Swift/Kotlin method service.
- Added bounded input validation and a sampled preview output interface.
- November 4, 2026: documented `at` as output (timeline) position, matching
  upstream `meanOf` and its playhead-based point placement.
- No upstream Compose UI, music/audio/media assets or icon files are copied.
- Original UI, full retime engine integration, and direct manipulable view remain unbuilt.

What was adapted: `CURVE_MIN`/`CURVE_MAX`, `speedToY`/`yToSpeed` (here
`speedToPosition`/`positionToSpeed`) and `meanOf` (here `meanSpeed`), lines 43-59
of the upstream file. Upstream `meanOf` returns 1.0 for a non-positive area; this
port rejects such curves in validation instead, because every valid speed is >= 0.1.

Upstream NOTICE: https://github.com/artcraft-android/capcraft-android/blob/5aee26b887ec2383acb9769714613b9691135f66/NOTICE
Upstream third-party notices: https://github.com/artcraft-android/capcraft-android/blob/main/THIRD_PARTY_NOTICES.md

This copy and adaptations retain the AGPL-3.0-or-later license. They may
impose source availability obligations on combined distributed works.
A Nitro/Expo bridge alone does not make the resulting combination proprietary.
Experimental package: not linked into any shipped Forge app. CI
(`scripts/check-agpl-isolation.mjs`) fails if any other workspace package or app
declares a dependency on it.

This program is free software: you can redistribute it and/or modify it under the
terms of the GNU Affero General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later version.
This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.
