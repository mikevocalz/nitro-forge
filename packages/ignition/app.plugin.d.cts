/**
 * Optionless Expo config plugin: `plugins: ["@nitro-forge/ignition"]`.
 * Validates the installed Expo/React Native/Nitro versions and the packaged
 * native/ asset manifest, then returns the config unchanged. It edits no native
 * files. iOS apps must set experiments.swiftPackageManager: true in app config.
 *
 * Typed structurally so Ignition does not take a type dependency on Expo.
 * @throws Error for unsupported config/dependencies or incomplete native assets.
 */
declare function withForge<T extends { _internal?: { projectRoot?: string } }>(config: T, options?: undefined): T;
export = withForge;
