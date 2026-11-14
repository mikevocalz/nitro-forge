import type { ConfigPlugin } from 'expo/config-plugins';

/** Validates installed Forge native assets and the supported Expo/Nitro graph.
 * Declare experiments.swiftPackageManager:true in initial app config for iOS.
 * No options, runtime loading, native edits, subprocesses or acquired resources.
 * @throws Error for unsupported config/dependencies or incomplete native assets.
 */
declare const withForge: ConfigPlugin<void>;
export = withForge;
