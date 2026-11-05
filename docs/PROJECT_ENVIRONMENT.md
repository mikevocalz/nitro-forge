# Project environment — Studio follow-up, November 3, 2026

Environment inspection used a subagent. This monorepo has pure Rust engines and
React Native examples. The Studio branch's Expo example uses Expo 54, React
Native 0.81, Expo Router 6 and the existing Nitro 0.29 spec. Its native runtime
is not implemented on this branch, so typechecking does not establish a runnable
native editor. Do not replace that runtime with mock document state.

For Studio visual work, the real-engine browser harness is:

```sh
pnpm install --frozen-lockfile
cargo build --locked -p nf-cli
pnpm --filter @nitro-forge/studio-preview dev
```

It serves `http://127.0.0.1:4173` and launches the local CLI through Vite's
same-origin development bridge. `pnpm --filter @nitro-forge/studio-preview test:integration` starts an isolated bridge on port 4185 and checks seven-engine
round trips. It terminates its own server afterward. The long-lived 4173 server
is retained for visual review.

Argent CLI 0.31.0 is on PATH; no Argent MCP tools were exposed in this session.
`argent run list-devices` listed a connected Quest and an unreachable paired
physical iPhone, with no running simulator/emulator/Chromium CDP target. The
Studio browser was inspected through the connected Chrome computer-use tools.
No physical device was selected or launched for this work.

A separate `nitro-forge-moyo-board` worktree contains an Expo 58 / React Native
0.88 native Board lab and generated Android build output. It was inspected
read-only and is not the Studio implementation target. Preserve its output and
configuration.

The current browser entry is an app list, with independent `#/apps/<app>` routes.
Opened sessions survive navigation through the list; browser reload ends them.
Quill now has a writable stage and DOCX import/export in the browser harness.

Studio's UI is NYC-Tron UI, installed from the release tarballs pinned with
their sha256 in `tooling/nyc-tron.json` (`node tooling/verify-nyc-tron.mjs`
checks the pins). No sibling checkout is needed. See
`docs/ux/studio-refresh/OWN_UI_INTEGRATION.md` for the slot map.
