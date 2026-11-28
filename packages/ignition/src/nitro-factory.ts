import generated from "#nitro/ForgeFactory";
import { NitroHost, type EngineHost } from "./host.ts";
import type { ForgeFactory } from "./specs/ForgeFactory.nitro.ts";

/**
 * React Native build of {@link createNativeForgeFactory}: constructs the
 * Nitro v1 ForgeFactory HybridObject. Only `index.native.ts` imports this
 * module, and only the package's `react-native` export condition reaches that,
 * so Node and web never load `react-native-nitro-modules`.
 *
 * The generated module looks the class up with `getHybridClass` on first
 * property access, so importing it has no native side effect; the lookup runs
 * when this function is called. Callers own and must close documents and
 * caches.
 */
export function createNativeForgeFactory(): ForgeFactory {
  const { ForgeFactory: HybridForgeFactory } = generated as unknown as {
    readonly ForgeFactory: new () => ForgeFactory;
  };
  return new HybridForgeFactory();
}

export function createNitroHost(): EngineHost {
  return new NitroHost(createNativeForgeFactory());
}
