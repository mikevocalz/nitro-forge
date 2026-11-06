/** The browser harness exclusively uses the real Rust CLI bridge. */
export const NitroModules = {
  createHybridObject(): never {
    throw new Error('Native Nitro objects require a native app; use the local Rust bridge in this browser harness.');
  },
};
