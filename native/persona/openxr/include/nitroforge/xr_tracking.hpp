#pragma once
#include <openxr/openxr.h>
#include <array>
#include <stdexcept>
#include <string>
#include <vector>

namespace nitroforge::persona::xr {
enum class Provider { meta, android };
enum class FaceSource { unknown, visual, audio };
enum class EyePrecision { coarse, fine };
class Error : public std::runtime_error {
 public:
  Error(const char* operation, XrResult code);
  const XrResult result;
};
// Borrowed instance/session. Host must keep both alive, serialize all calls,
// grant OS permissions, and close trackers before destroying the session.
struct Context {
  XrInstance instance;
  XrSession session;
  XrSystemId system;
  PFN_xrGetInstanceProcAddr resolve;
  // Exact extensions enabled at xrCreateInstance, not merely enumerated support.
  std::vector<std::string> enabledExtensions;
};
struct FaceFrame {
  Provider provider = Provider::meta;
  FaceSource source = FaceSource::unknown;
  XrTime time = 0;
  uint32_t count = 0;
  std::array<float, XR_FACE_EXPRESSION2_COUNT_FB> weights{};
  std::array<bool, XR_FACE_EXPRESSION2_COUNT_FB> valid{};
  uint32_t confidenceCount = 0;
  std::array<float, XR_FACE_REGION_CONFIDENCE_COUNT_ANDROID> confidences{};
};
struct EyeFrame {
  XrTime time = 0;
  XrSpace baseSpace = XR_NULL_HANDLE;
  std::array<XrPosef, 2> poses{};
  std::array<bool, 2> valid{};
  // Android exposes state instead of confidence; do not fabricate confidence.
  std::array<float, 2> confidence{};
  bool hasConfidence = false;
  std::array<XrEyeStateANDROID, 2> androidState{};
};
class FaceTracker final {
 public:
  // Meta chooses exactly one source. Android v1 has no source discriminator;
  // use unknown (never label its output visual without evidence).
  FaceTracker(const Context&, Provider, FaceSource);
  ~FaceTracker();
  FaceTracker(const FaceTracker&) = delete;
  FaceTracker& operator=(const FaceTracker&) = delete;
  XrResult poll(XrTime requestedTime, FaceFrame& output);
  XrResult close() noexcept;
 private:
  Provider provider_;
  FaceSource source_;
  XrFaceTracker2FB meta_ = XR_NULL_HANDLE;
  XrFaceTrackerANDROID android_ = XR_NULL_HANDLE;
  PFN_xrDestroyFaceTracker2FB destroyMeta_ = nullptr;
  PFN_xrGetFaceExpressionWeights2FB getMeta_ = nullptr;
  PFN_xrDestroyFaceTrackerANDROID destroyAndroid_ = nullptr;
  PFN_xrGetFaceStateANDROID getAndroid_ = nullptr;
};
class EyeTracker final {
 public:
  EyeTracker(const Context&, Provider, EyePrecision = EyePrecision::coarse);
  ~EyeTracker();
  EyeTracker(const EyeTracker&) = delete;
  EyeTracker& operator=(const EyeTracker&) = delete;
  XrResult poll(XrTime, XrSpace baseSpace, EyeFrame&);
  XrResult close() noexcept;
 private:
  Provider provider_;
  XrEyeTrackerFB meta_ = XR_NULL_HANDLE;
  XrEyeTrackerANDROID android_ = XR_NULL_HANDLE;
  PFN_xrDestroyEyeTrackerFB destroyMeta_ = nullptr;
  PFN_xrGetEyeGazesFB getMeta_ = nullptr;
  PFN_xrDestroyEyeTrackerANDROID destroyAndroid_ = nullptr;
  PFN_xrGetCoarseTrackingEyesInfoANDROID getAndroid_ = nullptr;
};
}
