import type { EngineHost } from "@nitro-forge/ignition";
import type { NativeForgeWindows } from "./native-transport";
import { WindowsHost } from "./windows-host";

/**
 * Create a Windows transport for the existing Ignition {@link EngineHost} API.
 * The application's native package provider must register ForgeWindows first.
 * Dispose the returned host when its documents are no longer needed.
 *
 * @throws If the ForgeWindows native module is not registered.
 * @see EngineHost.dispose
 */
export function createWindowsHost(): EngineHost {
  // Lazy lookup keeps framework-free tools and transport tests importable.
  const { TurboModuleRegistry } = require("react-native") as {
    TurboModuleRegistry: { getEnforcing<T>(name: string): T };
  };
  return new WindowsHost(TurboModuleRegistry.getEnforcing<NativeForgeWindows>("ForgeWindows"));
}
