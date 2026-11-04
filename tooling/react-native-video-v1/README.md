# Experimental upstream port: reproduction

Upstream: react-native-video beta.12, commit `321b868085e49669a6fe1aa1cfb58e64d63d326f`.
Combined patch: `react-native-video-beta12-nitro-v1-experimental-port.patch`.
License: original MIT text retained in `UPSTREAM-LICENSE` and upstream checkout. This patch is an uncompiled experimental fork, not a drop-in production release.

Run against an isolated checkout only:

```sh
test "$(git -C "$UPSTREAM" rev-parse HEAD)" = 321b868085e49669a6fe1aa1cfb58e64d63d326f
git -C "$UPSTREAM" apply --check /absolute/path/react-native-video-beta12-nitro-v1-experimental-port.patch
git -C "$UPSTREAM" apply /absolute/path/react-native-video-beta12-nitro-v1-experimental-port.patch
PROBE=$(mktemp -d)
printf '{"private":true}\n' > "$PROBE/package.json"
VERSION=1.0.0-alpha.nightly.120.g33ef045b96c0
npm_config_cache=/tmp/npm-forge-video XDG_DATA_HOME=/tmp/forge-pnpm-data \
  npm install --prefix "$PROBE" --ignore-scripts \
  "nitrogen@$VERSION" "react-native-nitro-modules@$VERSION" \
  react-native@0.88.0 react@19.3.0 @types/react@19.3.0 \
  typescript@7.0.2 @types/node@26.6.6 @expo/config-plugins@10.0.2
cp -R "$UPSTREAM/packages/react-native-video" "$PROBE/video"
cd "$PROBE/video"
../node_modules/.bin/nitrogen
cat > tsconfig.probe.json <<'JSON'
{
  "compilerOptions": {
    "target": "ESNext", "lib": ["ESNext"], "module": "ESNext",
    "moduleResolution": "bundler", "jsx": "react-jsx", "strict": true,
    "noEmit": true, "skipLibCheck": true, "esModuleInterop": true,
    "allowSyntheticDefaultImports": true, "types": ["node", "react"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["src/**/*.web.ts", "src/**/*.web.tsx", "src/core/web/**"]
}
JSON
../node_modules/.bin/tsc -p tsconfig.probe.json
cd "$PROBE"
node - <<'JS'
const {TypeScriptParser} = require('@react-native/codegen/lib/parsers/typescript/parser');
const schema = new TypeScriptParser().parseFile('video/src/spec/fabric/VideoViewNativeComponent.ts');
console.log(Object.keys(schema.modules)); // ['RNCVideoView']
JS
```

Verified: exact v1 generator 7/7; full native source TypeScript probe exits 0; actual RN 0.88 Fabric parser accepts updated public import and produces RNCVideoView. This excludes web sources and does not run upstream test suite. @expo/config-plugins is upstream optional config tooling needed to typecheck its existing source; no Expo Video dependency was introduced.

Manifest now marks `7.0.0-beta.12-nitrov1-experimental.0`, pins exact v1 generator/runtime, requires RN >=0.88, and records tested React/TypeScript dev versions. The probe installs tools in a separate parent package rather than running original package install/build lifecycle scripts. Native compilation and published packaging remain blocked as detailed in MIGRATION.md.

## Forge integration boundary

This directory is not a workspace package and is not autolinked. It retains
experimental port material only. Forge playback remains explicitly unavailable
until native ABI/build migration and real device tests succeed. Do not apply
this patch as a dependency override to a shipping app.
