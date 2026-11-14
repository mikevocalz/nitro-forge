# Forge #82 rendered shell proof

Recorded 2026-11-13 against PR head `166f22f7267fe9eb8f6c1f97a9b8b9555e03d926` and tested merge revision `370e10b6b2c95ddeeeb2ae0ad89815e5305c884f`.

## Build identity

- Successful Studio CI run: [43514127599](https://github.com/mikevocalz/nitro-forge/actions/runs/43514127599), attempt 1.
- Artifact: `studio-preview-rendered-build`, ID `14080002313`, retained after both Chromium render modes and the remaining dock-layout checks passed.
- Downloaded ZIP SHA-256 matched GitHub's digest: `8725d80cecc9c562e4c7b56ca3b470fce8a35db93c0169d864df9911db10fed6`.
- Safe ZIP paths and symlink attributes were checked before extraction.
- All eight dist files matched the retained byte counts and SHA-256 values, with no extra dist files. The actual source lockfile at the PR head matched `500c55952409c95c7565853402bb0f4586d6f694a080c27afa2b32bbcd532b9c`.
- Original metadata is retained in [provenance.json](provenance.json).

The tested bundle was served unchanged with Python's static HTTP server on `127.0.0.1:4192`. Chrome 157.0.8103.52 ran with a separate task profile and CDP port 9222. Argent selected `chromium-cdp-9222`; no simulator or physical device was selected.

## Actual interaction

1. Argent DOM discovery found the Apps screen, visible All applications heading and the Open Prism link.
2. Connected the Argent debugger, reloaded the launcher and awaited the observed All applications heading. The connected console registry reported zero entries at this point. A settled explicit capture showed the launcher: [launcher.png](launcher.png).
3. Tapped the centre of the freshly described Open Prism link at normalized `(0.6825, 0.3685)`. Prism's title, artboard, tool rail, Layers empty state and workspace shell rendered: [prism-shell-backend-unavailable.png](prism-shell-backend-unavailable.png).
4. The static server has no engine bridge. The Prism capture therefore retains the visible JSON/HTML response error and disabled engine controls; this is not an engine-operation pass. The connected console registry afterward contained one React Native Web Animated fallback warning, not an uncaught module-linking error.

The screenshot adapter's automatic post-navigation image could show a transitional blank frame while the DOM was populated. The retained launcher image is the later explicit settled capture. Requested screenshot downscaling was unavailable because the optional sharp package was absent; the saved captures retain the tool's original resolution.

## Verdict and limits

Observed: the actual candidate production bundle renders its launcher, and navigation mounts the Prism shell. The prior blank-page failure is not present in this path. CI separately passed the dev and production launcher-render commands.

NOT RUN: local dependency installation or rebuild; a Vite/nf-cli-backed engine session; F3 pivot, sensitivity, marker mutation or undo/redo interactions; iOS/Android/iPad/Quest/PICO execution; accessibility speech, contrast or design acceptance. No F3, F4, F7 or F8 gate status is promoted by this shell proof.

Independent R2 inspected both actual images, independently verified the ZIP and all eight dist hashes, and read the CI render/upload logs. R2 signed this scoped render proof at exact PR head `166f22f7267fe9eb8f6c1f97a9b8b9555e03d926`, conditional on every required exact-head workflow passing before merge. F3 engine acceptance remains unsigned.
