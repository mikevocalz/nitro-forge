# Experimental upstream port: reproduction

Upstream: react-native-video beta.12, commit `321b868085e49669a6fe1aa1cfb58e64d63d326f`.
Combined patch: `react-native-video-beta12-nitro-v1-experimental-port.patch`.
Original MIT license retained in `UPSTREAM-LICENSE`. This source patch is an experimental native fork, not a production release. Existing recovered acceptance-lab manifests select a local `.1` tarball; that recovered selection is not production approval.

Run in an isolated checkout of that exact upstream commit. Set UPSTREAM to the checkout and ARTIFACTS to this directory:

```sh
test "$(git -C "$UPSTREAM" rev-parse HEAD)" = 321b868085e49669a6fe1aa1cfb58e64d63d326f
git -C "$UPSTREAM" apply --check "$ARTIFACTS/react-native-video-beta12-nitro-v1-experimental-port.patch"
git -C "$UPSTREAM" apply "$ARTIFACTS/react-native-video-beta12-nitro-v1-experimental-port.patch"
PROBE=$(mktemp -d)
printf '{"private":true}\n' > "$PROBE/package.json"
VERSION=1.0.0-alpha.nightly.120.g33ef045b96c0
npm install --prefix "$PROBE" --ignore-scripts \
  "nitrogen@$VERSION" "react-native-nitro-modules@$VERSION" \
  react-native@0.88.0 react@19.3.0 @types/react@19.3.0 \
  typescript@7.0.2 @types/node@26.6.6 @expo/config-plugins@10.0.2 \
  react-native-builder-bob@0.40.0 @babel/plugin-syntax-decorators@7.27.1
# Use a fresh checkout without existing node_modules.
ln -s "$PROBE/node_modules" "$UPSTREAM/node_modules"
cd "$UPSTREAM/packages/react-native-video"
../../node_modules/.bin/nitrogen
../../node_modules/.bin/bob build
python android/tests/check-nitro-v1-abi.py
python "$ARTIFACTS/check-swift-abi.py" .
python "$ARTIFACTS/check-concurrency.py" .
node - <<'JS'
const {TypeScriptParser} = require('@react-native/codegen/lib/parsers/typescript/parser');
console.log(Object.keys(new TypeScriptParser().parseFile('src/spec/fabric/VideoViewNativeComponent.ts').modules));
JS
npm pack --dry-run --ignore-scripts --json > /tmp/video-pack.json
node "$ARTIFACTS/check-package.cjs" /tmp/video-pack.json
```

Verified on November 4, 2026: exact generator 7/7; real Bob module and declaration builds; native-source TypeScript (web excluded); RN 0.88 Fabric schema; 5 Android source-contract tests; 49 Swift method signatures and 26 callback dispatches; npm packed entrypoint/import-map presence; bounded concurrency source contracts with 15 mutation regressions. These are not native compiler or runtime tests. Optional upstream Expo config-plugin source requires @expo/config-plugins for typechecking; no Expo Video or Expo Audio was added.

Generated native files are not included in the source patch. Nitrogen regenerates them and the Package.swift helper. Build output is module-only esm:false, with built source/react-native entrypoints and no nested package scopes hiding #nitro imports. No Node CommonJS/SSR support claim is made.

## Forge integration boundary

This directory is not a workspace package or autolinked. The recovered media-ui package declares the exact experimental player as an optional peer and selects the local candidate as a development dependency. That baseline is preserved together with its lockfile. Its root entrypoint does not import the video entrypoint. Consumers that explicitly import `@nitro-forge/media-ui/video` must supply the compatible player; optional peer metadata does not make that entrypoint usable without one.

The recovered `examples/native-cadence/package.json` still selects `experimental-build-v1.tgz`, and recovered lockfiles record local artifacts. Those are preserved work in progress, not an approved default. They must be reconciled separately before a clean frozen install can be claimed. No package-manifest or lockfile change was retained in this audit.

## Opt-in candidate and reproducibility gap

Use a separate acceptance checkout/host to opt in. The safe future migration is to keep the root/media-ui default dependency graph free of the candidate, but that requires a reviewed manifest-and-lockfile change together; removing only its manifest entry triggered unpublished peer resolution in the existing package-manager pre-run hook and was reverted. Only the acceptance host should add the local `react-native-video` tarball, use the exact Nitro runtime listed above and satisfy the host build settings in MIGRATION.md. Preserve the original tarball; record its checksum alongside native build and playback evidence. Do not substitute upstream beta.12, which has a different Nitro ABI.

The original source patch produces version `.0`; the recovered selected tarball identifies itself as `.1`. `react-native-video-beta12-nitro-v1-experimental-1-recovered.patch` now recovers the `.1` source against the same upstream commit. See PROVENANCE.md for the exact archive comparison and one recovered-file override. A regenerated/rebuilt artifact comparison is still required before claiming packaging reproducibility. Do not relabel `.0` output as `.1` or overwrite either recovered tarball. The reproduction instructions above reproduce the pinned `.0` source candidate and its static checks, not the selected `.1` artifact.

Before promoting an opt-in candidate: review the recovered `.1` source delta, regenerate with pinned Nitrogen, retain generated package output and provenance, compile each native target, validate playback/lifecycle gates, and update the acceptance-host manifest plus its lockfile together in a reviewed phase. No install or native validation was run for this documentation/manifest reconciliation.

Selected artifact observed SHA-256: `0758b71466e5b4e60705c3386516f2bd212cb4056a5f38547f0480465800bb44` (`experimental-build-v1.tgz`). This identifies preserved bytes; it is not provenance proof. A direct invocation of the installed TypeScript compiler passed. A pnpm script command unexpectedly invoked its dependency verification/install hook and failed to resolve the unpublished `.1` peer; no successful dependency installation is claimed. No further package-manager invocation was made.
