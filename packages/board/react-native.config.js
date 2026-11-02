// Only the Android native implementation exists today. visionOS/iOS keep the
// caller's configured fallback until a real Apple renderer is implemented.
module.exports = {
  dependency: { platforms: { android: {} } },
};
