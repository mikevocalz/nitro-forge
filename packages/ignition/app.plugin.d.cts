/** A studio engine nf-sys can link. Same names as ForgeEngineKind. */
type ForgeEngineName =
  | 'prism' | 'cadence' | 'splice' | 'folio' | 'pitch' | 'tally'
  | 'quill' | 'photo' | 'motion' | 'design' | 'draft' | 'scene';

interface ForgeOptions {
  /**
   * Studio engines this app ships; default all. Written as
   * nitroForge.engines to android/gradle.properties and
   * ios/Podfile.properties.json. Build nf-sys with the same set
   * (NF_ENGINES or NF_APP_ROOT) so the other engines are not linked.
   */
  engines?: readonly ForgeEngineName[];
}

/**
 * Expo config plugin: `plugins: ["@nitro-forge/ignition"]` or
 * `plugins: [["@nitro-forge/ignition", { engines: ["prism", "tally"] }]]`.
 * Validates the installed Expo/React Native/Nitro versions and the packaged
 * native/ asset manifest. Without options it returns the config unchanged and
 * edits no native files. iOS apps must set experiments.swiftPackageManager:
 * true in app config.
 *
 * Typed structurally so Ignition does not take a type dependency on Expo.
 * @throws Error for unsupported config/dependencies, invalid engines or
 * incomplete native assets.
 */
declare function withForge<T extends { _internal?: { projectRoot?: string } }>(config: T, options?: ForgeOptions): T;
declare namespace withForge {
  const ENGINES: readonly ForgeEngineName[];
  const ENGINES_PROPERTY: 'nitroForge.engines';
  function parseEngineList(value: unknown, source: string): ForgeEngineName[];
}
export = withForge;
