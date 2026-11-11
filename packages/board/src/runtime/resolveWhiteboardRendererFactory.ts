import { NitroModules } from "react-native-nitro-modules";
import * as generated from "#nitro/WhiteboardRendererFactory";
import type { WhiteboardRendererFactory } from "../specs/WhiteboardRendererFactory.nitro";

type Runtime = { readonly WhiteboardRendererFactory: typeof WhiteboardRendererFactory };
// v1 generated files are CommonJS with a lazy export; Babel may expose both
// namespace and default. Never import a decorator spec as a runtime object.
const runtime: Runtime =
  (generated as unknown as { readonly default?: Runtime }).default ??
  (generated as unknown as Runtime);

/** Undefined on web, Apple, Android <29 or Android without CanvasSurfaces. */
export function resolveWhiteboardRendererFactory(): typeof WhiteboardRendererFactory | undefined {
  if (!NitroModules.hasHybridClass("forgeboard.WhiteboardRendererFactory")) return undefined;
  const factory = runtime.WhiteboardRendererFactory;
  return factory.isAvailable ? factory : undefined;
}
