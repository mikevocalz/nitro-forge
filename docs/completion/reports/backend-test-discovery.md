# Backend source test discovery

2026-11-07. Photo, Motion, Design and Draft had TypeScript behavior tests but no package test script. Design's temporary config also assumed the repository working directory. Normal workspace test runs could skip those cases.

Each package now has a test script using the portable shared `tooling/completion-backends.vitest.config.mjs`. Its root is derived from its file URL, and its explicit workspace alias points to the same real Ignition source as the declared dependency. The repository's `test:completion-backends` entry first runs the four Rust suites, builds the real CLI and then runs the source tests. The existing Ignition CI workflow calls that entry and watches the new packages and config. No dependencies, lockfile resolution, package pins or native ABI change.

The source runner passes eighteen tests across seven files, including a Photo-to-Motion pixel/ownership/history/reopen flow. Its independent Rust suites pass 54 tests: Design 18, Draft 11, Motion 14 and Photo 11. Four focused Photo/Motion binary FFI tests pass. The Design package's equivalent command also passes from its own directory, verifying the working-directory fix. The preview TypeScript check passes.

The interoperability fixture supplies synthetic decoded RGBA and host-claimed catalog identity; it is not RAW decoding or camera provenance. These are source/CLI checks, with no installed public consumer, native device or full P19 acceptance claim. Remote CI results remain separate from these local executions.
