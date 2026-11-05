/** Selected implementation. No substitute backend is installed implicitly. */
export const VIDEO_PLAYBACK_CAPABILITY = Object.freeze({
  status: "blocked" as const,
  library: "react-native-video" as const,
  version: "7.0.0-beta.12" as const,
  requiredRuntime: "Nitro v1" as const,
  reason: "Video playback is unavailable while the react-native-video adapter is ported and validated against Nitro v1.",
});
