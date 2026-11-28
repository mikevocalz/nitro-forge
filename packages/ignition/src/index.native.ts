// React Native entry, selected by the package's `react-native` export
// condition. Same public API as index.ts; the two native constructors are
// replaced with versions that load the generated Nitro HybridObject.
export * from "./index.ts";
export { createNativeForgeFactory, createNitroHost } from "./nitro-factory.ts";
