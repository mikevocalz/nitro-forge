# Install notes for StudioScreen.tsx

Read this first: the checkout gives no consumer install path for the Nitro Forge side. I could not find a published npm package or a documented "add to your app" recipe. Everything below is inferred from `apps/example` (package.json, metro.config.cjs, global.css, app/_layout.tsx, src/studio-ui.tsx) and `packages/studio-workspace`.

## What is clear

- `@nitro-forge/studio-workspace`, `@nitro-forge/icons`, `@nitro-forge/studio-layout` and `@nitro-forge/ignition` are `"private": true` workspace packages (`workspace:*`). Their `exports` point at TypeScript source (`./src/ui.tsx`), so a consumer needs Metro to compile them.
- NYC-Tron UI is not on npm. It comes from GitHub Release tarballs pinned in `tooling/nyc-tron.json` (v1.0.0-rc.2).
- `StudioUIProvider` is mandatory. Without it every Studio component throws "Studio requires StudioUIProvider".
- NYC-Tron ships no colours. The app must import Forge's generated `theme.native.css`, which defines `--color-primary`, `--color-accent` and the rest.
- The example targets Expo 58, RN 0.88.1, React 19.3.1, Uniwind 1.13.2, Tailwind 4.3.5.

## Ordered steps (inferred, not run)

1. Create the app on the example's versions: `npx create-expo-app@latest studio --template blank-typescript`. Expo SDK 58 / RN 0.88.1 is what the example uses; I did not confirm that `create-expo-app@latest` yields SDK 58. Pin `expo@58.0.24` if it does not.
2. Obtain Nitro Forge. Unclear how. Practical route: clone the monorepo next to the app and add the four workspace packages by `file:` or `link:` path (`studio-workspace`, `studio-layout`, `icons`, `ignition`). Their own deps use `workspace:*`, which pnpm resolves only inside the monorepo, so the cleanest working option is to place the app under `apps/` in the Forge monorepo (`pnpm-workspace.yaml` already globs `apps/*`). Unverified.
3. Install runtime deps (versions from apps/example/package.json):
   `expo-router`, `react-native-gesture-handler@3.5.0`, `react-native-reanimated@4.7.1`, `react-native-worklets@0.13.1`, `react-native-svg@15.16.0`, `react-native-safe-area-context@5.11.1`, `react-native-screens@4.30.1`, `@expo/ui@58.0.28`, `expo-constants`, `expo-file-system`, `expo-image`, `expo-haptics`, `zustand@5.1.0`, `uniwind@1.13.2`, `tailwindcss@4.3.5`.
4. Install NYC-Tron tarballs (same URLs in apps/example/package.json):
   - `@nyc-tron/ui`: https://github.com/mikevocalz/NYC-Tron-UI/releases/download/v1.0.0-rc.2/nyc-tron-ui-1.0.0-rc.2.tgz
   - `@nyc-tron/core`: .../nyc-tron-core-1.0.0-rc.2.tgz
   - `@nyc-tron/expo-controls`: .../nyc-tron-expo-controls-1.0.0-rc.2.tgz
   - `@nyc-tron/reserved-regions`: .../nyc-tron-reserved-regions-1.0.0-rc.2.tgz (the example uses it for fold geometry; my screen does not import it, so I think it is optional here; unverified).
   `@nyc-tron/expo-controls` likely pulls native modules (`@expo/ui`, `@nyc-tron/native-controls`). Not verified.
5. `metro.config.cjs`, copied from the example:
   ```js
   const { getDefaultConfig } = require('expo/metro-config');
   const { withUniwindConfig } = require('uniwind/metro');
   const config = getDefaultConfig(__dirname);
   module.exports = withUniwindConfig(config, {
     cssEntryFile: './global.css',
     dtsFile: './src/uniwind-types.d.ts',
     polyfills: { rem: 14 },
   });
   ```
   If the app is outside the monorepo, add the Forge root to `config.watchFolders`. The example also installs `createHostNativeResolver` from `apps/example/tooling/host-native-resolver.cjs`. I did not read what it fixes; it may be required. Unclear.
6. `global.css` (paths relative to your app; the example uses `../../packages/...`):
   ```css
   @import 'tailwindcss';
   @import 'uniwind';
   @import '<forge>/packages/studio-workspace/src/theme.native.css';
   @source './src';
   @source '<forge>/packages/studio-workspace/src';
   @source '<forge>/packages/icons/src';
   @source './node_modules/@nyc-tron/ui/dist/components';
   @source './node_modules/@nyc-tron/expo-controls/dist/components';
   ```
   `import './global.css'` once at the app root (the example does it in `app/_layout.tsx`).
7. Babel/Reanimated: the example has no babel.config in apps/example; Expo 58 presumably handles the worklets plugin. Unverified.
8. Native build: the example uses a dev client (`expo-dev-client`) and Nitro modules, so Expo Go will not work. Run `npx expo prebuild` then `npx expo run:ios` or `run:android`. For this screen alone, `@nitro-forge/ignition` (Nitro/Rust engine) is only needed if you open real documents; the screen takes `state` as a prop and does not import it. `@nitro-forge/studio-workspace/src/index.tsx` does import `@nitro-forge/ignition`, `studio-layout` and `react-native-gesture-handler`, so those must still resolve at bundle time.
9. Wrap the app root in `GestureHandlerRootView` (the example does this in `app/_layout.tsx`). StudioScreen mounts `StudioUIProvider` itself, so a second provider is not needed.
10. Use it: `import StudioScreen from './StudioScreen'; <StudioScreen state={null} />`.

## Brand accent

`STUDIO_BRAND` in StudioScreen.tsx holds the single hex pair. `nycTronTokensFor` (from `@nitro-forge/studio-workspace/directions`) turns it into the `--color-*` variables, applied with `TokenScope`. Alternative documented-in-source route: `ForgeWorkspace` takes `themeOverrides={{ accent, ink }}`, but that is for the full dock workspace, not this screen.

## Unclear points

- No documented consumer install; steps 2 and 8 are guesses.
- The stage: `ForgeDocumentStage` is a read-only projection and hardcodes its own paper colours and sizes, so "no raw colours" holds for my code, not for that component's insides.
- `README.md` says ForgeWorkspace needs `docs/ux/studio-refresh/OWN_UI_INTEGRATION.md`'s host binding; that doc still says alpha.3 while `tooling/nyc-tron.json` says rc.2. Trust the JSON.
- Classes `bg-surface-sunken` and `flex-1` rely on Uniwind/Tailwind picking up the `--color-surface-sunken` variable from theme.native.css. `bg-surface-sunken` was inferred from variable naming; not seen used in source.
- Whether `Toolbar` `actions` renders on compact widths: types only.
