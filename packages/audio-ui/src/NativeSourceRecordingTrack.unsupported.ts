/**
 * Resolved by the "default" condition of the "./pcm" export: a bundler or
 * runtime that set neither "react-native" nor "browser". Fails at import so
 * a wrong resolver never silently gets the web MediaRecorder fallback.
 */
throw new Error(
  "@nitro-forge/audio-ui/pcm needs the \"react-native\" (iOS/Android) or " +
  "\"browser\" (web) export condition. Configure your bundler's condition names.",
);
export {};
