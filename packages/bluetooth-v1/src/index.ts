import { NitroModules } from "react-native-nitro-modules";
import * as generated from "#nitro/ForgeBluetooth";
import type { ForgeBluetooth } from "./specs/ForgeBluetooth.nitro";
type Runtime = { readonly ForgeBluetooth: typeof ForgeBluetooth };
const runtime: Runtime =
  (generated as unknown as { readonly default?: Runtime }).default ??
  (generated as unknown as Runtime);
export function getForgeBluetooth(): typeof ForgeBluetooth | undefined {
  if (!NitroModules.hasHybridClass("forgebluetooth.ForgeBluetooth")) return undefined;
  return runtime.ForgeBluetooth.isAvailable ? runtime.ForgeBluetooth : undefined;
}
export type { ForgeBluetooth } from "./specs/ForgeBluetooth.nitro";
