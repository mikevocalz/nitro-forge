# Install, in order

Run from <scratch>/accept/app-forge
with PATH prefixed by the spike shim dir and `</dev/null`.

## Ran (registry, one call; exit clean, 61 files written under src/)

    npx -y shadcn@4.23.0 add @nitro-forge/studio-ui-provider @nitro-forge/nyc-tron-host \
      @nitro-forge/forge-icon-button @nitro-forge/forge-document-stage \
      @nitro-forge/brand-theme @nitro-forge/studio-theme -y

Also pulled in by dependency: forge-icon, forge-directions, 18 @nyc-tron items.
npm installs were no-ops (shim), so react-native-svg@15.16.0 is NOT actually installed here.

## By hand (docs say shadcn cannot do these; none done)

1. @nyc-tron/expo-controls tarball (Select, NativePopover, NativeActionMenu), pinned in NYC-Tron
   tooling/nyc-tron.json, release v1.0.0-rc.2 of mikevocalz/NYC-Tron-UI:
   https://github.com/mikevocalz/NYC-Tron-UI/releases/download/v1.0.0-rc.2/nyc-tron-expo-controls-1.0.0-rc.2.tgz
   Add as a URL dependency in package.json. The screen imports it for the host wiring.
2. @nitro-forge/studio-layout: stage.tsx has `import type { Studio } from '@nitro-forge/studio-layout'`.
   Private, no tarball, not installable. Type-only (erased at runtime), but tsc fails without it.
3. Theme CSS: add `@import` of src/components/forge/theme.native.css (Uniwind) or theme.css (web, Tailwind v4)
   to global.css, plus Uniwind/Tailwind setup and Metro `withUniwindConfig`. global.css is empty today.
4. tsconfig: add `"resolveJsonModule": true` (screen imports brand.theme.json).
5. Peers: react-native-svg 15.16.0 (patched upstream), react >=19, react-native >=0.81.
6. Not needed for this screen: ignition, engines, forge-workspace (needs studio-layout at runtime).
