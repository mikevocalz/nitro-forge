# Experimental upstream port: reproduction

Upstream: react-native-video beta.12, commit `321b868085e49669a6fe1aa1cfb58e64d63d326f`.
Combined patch: `react-native-video-beta12-nitro-v1-experimental-port.patch`.
Original MIT license retained in `UPSTREAM-LICENSE`. This is an uncompiled native fork, not a production release or enabled Forge dependency.

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
node - <<'JS'
const {TypeScriptParser} = require('@react-native/codegen/lib/parsers/typescript/parser');
console.log(Object.keys(new TypeScriptParser().parseFile('src/spec/fabric/VideoViewNativeComponent.ts').modules));
JS
npm pack --dry-run --ignore-scripts --json > /tmp/video-pack.json
node "$ARTIFACTS/check-package.cjs" /tmp/video-pack.json
```

Verified on November 4, 2026: exact generator 7/7; real Bob module and declaration builds; native-source TypeScript (web excluded); RN0.88 Fabric schema; 5 Android source-contract tests; 49 Swift method signatures and26 callback dispatches; npm packed entrypoint/import-map presence. These are not native compiler or runtime tests. Optional upstream Expo config-plugin source requires @expo/config-plugins for typechecking; no Expo Video or Expo Audio was added.

Generated native files are not included in the source patch. Nitrogen regenerates them and the Package.swift helper. Build output is module-only esm:false, with built source/react-native entrypoints and no nested package scopes hiding #nitro imports. No Node CommonJS/SSR support claim is made.

## Forge integration boundary

This directory is not a workspace package or autolinked. Forge's selected native player stays explicitly unavailable. Do not enable the patch as a dependency override until the native builds and playback tests in MIGRATION.md succeed.
