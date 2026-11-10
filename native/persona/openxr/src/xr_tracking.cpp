#include "nitroforge/xr_tracking.hpp"
#include <algorithm>
#include <cmath>

namespace nitroforge::persona::xr {
Error::Error(const char* operation, XrResult code)
    : std::runtime_error(std::string(operation) + " failed: " + std::to_string(code)), result(code) {}
namespace {
void require(XrResult result, const char* operation) {
  if (result != XR_SUCCESS) throw Error(operation, result);
}
void checkContext(const Context& c, const char* extension) {
  if (!c.instance || !c.session || !c.system || !c.resolve)
    throw std::invalid_argument("OpenXR context is incomplete");
  if (std::find(c.enabledExtensions.begin(), c.enabledExtensions.end(), extension) == c.enabledExtensions.end())
    throw Error("required extension not enabled", XR_ERROR_EXTENSION_NOT_PRESENT);
}
template<class T> T load(const Context& c, const char* name) {
  PFN_xrVoidFunction function = nullptr;
  require(c.resolve(c.instance, name, &function), name);
  if (!function) throw Error(name, XR_ERROR_FUNCTION_UNSUPPORTED);
  return reinterpret_cast<T>(function);
}
template<class T> void properties(const Context& c, T& extension) {
  XrSystemProperties properties{};
  properties.type = XR_TYPE_SYSTEM_PROPERTIES;
  properties.next = &extension;
  require(load<PFN_xrGetSystemProperties>(c, "xrGetSystemProperties")(c.instance, c.system, &properties), "xrGetSystemProperties");
}
bool weightValid(float weight) { return std::isfinite(weight) && weight >= 0 && weight <= 1; }
bool poseValid(const XrPosef& p) {
  const auto& q = p.orientation;
  const double norm = double(q.x)*q.x + double(q.y)*q.y + double(q.z)*q.z + double(q.w)*q.w;
  return std::isfinite(p.position.x) && std::isfinite(p.position.y) &&
         std::isfinite(p.position.z) && std::isfinite(norm) && std::abs(norm - 1) < 0.01;
}
}
FaceTracker::FaceTracker(const Context& c, Provider provider, FaceSource source)
    : provider_(provider), source_(source) {
  if (provider == Provider::meta) {
    checkContext(c, XR_FB_FACE_TRACKING2_EXTENSION_NAME);
    if (source != FaceSource::visual && source != FaceSource::audio)
      throw std::invalid_argument("Meta face source must be explicitly visual or audio");
    XrSystemFaceTrackingProperties2FB support{};
    support.type = XR_TYPE_SYSTEM_FACE_TRACKING_PROPERTIES2_FB;
    properties(c, support);
    if (!(source == FaceSource::visual ? support.supportsVisualFaceTracking : support.supportsAudioFaceTracking))
      throw Error("face source unsupported", XR_ERROR_FEATURE_UNSUPPORTED);
    auto create = load<PFN_xrCreateFaceTracker2FB>(c, "xrCreateFaceTracker2FB");
    destroyMeta_ = load<PFN_xrDestroyFaceTracker2FB>(c, "xrDestroyFaceTracker2FB");
    getMeta_ = load<PFN_xrGetFaceExpressionWeights2FB>(c, "xrGetFaceExpressionWeights2FB");
    auto requested = source == FaceSource::visual ? XR_FACE_TRACKING_DATA_SOURCE2_VISUAL_FB : XR_FACE_TRACKING_DATA_SOURCE2_AUDIO_FB;
    XrFaceTrackerCreateInfo2FB info{};
    info.type = XR_TYPE_FACE_TRACKER_CREATE_INFO2_FB;
    info.faceExpressionSet = XR_FACE_EXPRESSION_SET2_DEFAULT_FB;
    info.requestedDataSourceCount = 1;
    info.requestedDataSources = &requested;
    const auto result = create(c.session, &info, &meta_);
    if (result != XR_SUCCESS) { close(); require(result, "xrCreateFaceTracker2FB"); }
  } else if (provider == Provider::android) {
    checkContext(c, XR_ANDROID_FACE_TRACKING_EXTENSION_NAME);
    if (source != FaceSource::unknown)
      throw std::invalid_argument("Android face v1 source must remain unknown");
    XrSystemFaceTrackingPropertiesANDROID support{};
    support.type = XR_TYPE_SYSTEM_FACE_TRACKING_PROPERTIES_ANDROID;
    properties(c, support);
    if (!support.supportsFaceTracking) throw Error("face tracking unsupported", XR_ERROR_FEATURE_UNSUPPORTED);
    auto create = load<PFN_xrCreateFaceTrackerANDROID>(c, "xrCreateFaceTrackerANDROID");
    destroyAndroid_ = load<PFN_xrDestroyFaceTrackerANDROID>(c, "xrDestroyFaceTrackerANDROID");
    getAndroid_ = load<PFN_xrGetFaceStateANDROID>(c, "xrGetFaceStateANDROID");
    XrFaceTrackerCreateInfoANDROID info{};
    info.type = XR_TYPE_FACE_TRACKER_CREATE_INFO_ANDROID;
    const auto result = create(c.session, &info, &android_);
    if (result != XR_SUCCESS) { close(); require(result, "xrCreateFaceTrackerANDROID"); }
  } else throw std::invalid_argument("unknown XR provider");
}
FaceTracker::~FaceTracker() { close(); }
XrResult FaceTracker::close() noexcept {
  XrResult result = XR_SUCCESS;
  if (meta_) { result = destroyMeta_(meta_); meta_ = XR_NULL_HANDLE; }
  if (android_) { result = destroyAndroid_(android_); android_ = XR_NULL_HANDLE; }
  return result;
}
XrResult FaceTracker::poll(XrTime time, FaceFrame& output) {
  output = {};
  output.provider = provider_;
  if (!meta_ && !android_) return XR_ERROR_HANDLE_INVALID;
  FaceFrame frame{};
  frame.provider = provider_;
  XrResult result;
  if (meta_) {
    XrFaceExpressionInfo2FB info{};
    info.type = XR_TYPE_FACE_EXPRESSION_INFO2_FB; info.time = time;
    XrFaceExpressionWeights2FB data{};
    data.type = XR_TYPE_FACE_EXPRESSION_WEIGHTS2_FB;
    data.weightCount = XR_FACE_EXPRESSION2_COUNT_FB; data.weights = frame.weights.data();
    data.confidenceCount = XR_FACE_CONFIDENCE2_COUNT_FB; data.confidences = frame.confidences.data();
    result = getMeta_(meta_, &info, &data);
    if (result != XR_SUCCESS || !data.isValid) return result;
    frame.source = data.dataSource == XR_FACE_TRACKING_DATA_SOURCE2_VISUAL_FB ? FaceSource::visual :
                   data.dataSource == XR_FACE_TRACKING_DATA_SOURCE2_AUDIO_FB ? FaceSource::audio : FaceSource::unknown;
    if (frame.source != source_) return XR_ERROR_VALIDATION_FAILURE;
    frame.time = data.time; frame.count = XR_FACE_EXPRESSION2_COUNT_FB;
    frame.confidenceCount = XR_FACE_CONFIDENCE2_COUNT_FB;
    for (uint32_t i = 0; i < frame.count; ++i) {
      bool eye = i >= XR_FACE_EXPRESSION2_EYES_LOOK_DOWN_L_FB && i <= XR_FACE_EXPRESSION2_EYES_LOOK_UP_R_FB;
      frame.valid[i] = weightValid(frame.weights[i]) && (!eye || data.isEyeFollowingBlendshapesValid);
    }
  } else {
    XrFaceStateGetInfoANDROID info{};
    info.type = XR_TYPE_FACE_STATE_GET_INFO_ANDROID; info.time = time;
    XrFaceStateANDROID data{};
    data.type = XR_TYPE_FACE_STATE_ANDROID;
    data.parametersCapacityInput = XR_FACE_PARAMETER_COUNT_ANDROID; data.parameters = frame.weights.data();
    data.regionConfidencesCapacityInput = XR_FACE_REGION_CONFIDENCE_COUNT_ANDROID; data.regionConfidences = frame.confidences.data();
    result = getAndroid_(android_, &info, &data);
    if (result != XR_SUCCESS || !data.isValid || data.faceTrackingState != XR_FACE_TRACKING_STATE_TRACKING_ANDROID) return result;
    if (data.parametersCountOutput != XR_FACE_PARAMETER_COUNT_ANDROID || data.regionConfidencesCountOutput != XR_FACE_REGION_CONFIDENCE_COUNT_ANDROID)
      return XR_ERROR_VALIDATION_FAILURE;
    frame.time = data.sampleTime; frame.count = XR_FACE_PARAMETER_COUNT_ANDROID;
    frame.confidenceCount = XR_FACE_REGION_CONFIDENCE_COUNT_ANDROID;
    for (uint32_t i = 0; i < frame.count; ++i) frame.valid[i] = weightValid(frame.weights[i]);
  }
  output = frame;
  return XR_SUCCESS;
}
EyeTracker::EyeTracker(const Context& c, Provider provider, EyePrecision precision) : provider_(provider) {
  if (precision != EyePrecision::coarse && precision != EyePrecision::fine) throw std::invalid_argument("invalid eye precision");
  if (provider == Provider::meta) {
    checkContext(c, XR_FB_EYE_TRACKING_SOCIAL_EXTENSION_NAME);
    XrSystemEyeTrackingPropertiesFB support{}; support.type = XR_TYPE_SYSTEM_EYE_TRACKING_PROPERTIES_FB;
    properties(c, support);
    if (!support.supportsEyeTracking) throw Error("eye tracking unsupported", XR_ERROR_FEATURE_UNSUPPORTED);
    auto create = load<PFN_xrCreateEyeTrackerFB>(c, "xrCreateEyeTrackerFB");
    destroyMeta_ = load<PFN_xrDestroyEyeTrackerFB>(c, "xrDestroyEyeTrackerFB");
    getMeta_ = load<PFN_xrGetEyeGazesFB>(c, "xrGetEyeGazesFB");
    XrEyeTrackerCreateInfoFB info{}; info.type = XR_TYPE_EYE_TRACKER_CREATE_INFO_FB;
    const auto result = create(c.session, &info, &meta_);
    if (result != XR_SUCCESS) { close(); require(result, "xrCreateEyeTrackerFB"); }
  } else if (provider == Provider::android) {
    checkContext(c, XR_ANDROID_EYE_TRACKING_EXTENSION_NAME);
    XrSystemEyeTrackingPropertiesANDROID support{}; support.type = XR_TYPE_SYSTEM_EYE_TRACKING_PROPERTIES_ANDROID;
    properties(c, support);
    if (!support.supportsEyeTracking) throw Error("eye tracking unsupported", XR_ERROR_FEATURE_UNSUPPORTED);
    auto create = load<PFN_xrCreateEyeTrackerANDROID>(c, "xrCreateEyeTrackerANDROID");
    destroyAndroid_ = load<PFN_xrDestroyEyeTrackerANDROID>(c, "xrDestroyEyeTrackerANDROID");
    getAndroid_ = load<PFN_xrGetCoarseTrackingEyesInfoANDROID>(c, precision == EyePrecision::fine ? "xrGetFineTrackingEyesInfoANDROID" : "xrGetCoarseTrackingEyesInfoANDROID");
    XrEyeTrackerCreateInfoANDROID info{}; info.type = XR_TYPE_EYE_TRACKER_CREATE_INFO_ANDROID;
    const auto result = create(c.session, &info, &android_);
    if (result != XR_SUCCESS) { close(); require(result, "xrCreateEyeTrackerANDROID"); }
  } else throw std::invalid_argument("unknown XR provider");
}
EyeTracker::~EyeTracker() { close(); }
XrResult EyeTracker::close() noexcept {
  XrResult result = XR_SUCCESS;
  if (meta_) { result = destroyMeta_(meta_); meta_ = XR_NULL_HANDLE; }
  if (android_) { result = destroyAndroid_(android_); android_ = XR_NULL_HANDLE; }
  return result;
}
XrResult EyeTracker::poll(XrTime time, XrSpace space, EyeFrame& output) {
  output = {};
  if (!meta_ && !android_) return XR_ERROR_HANDLE_INVALID;
  if (!space) return XR_ERROR_HANDLE_INVALID;
  EyeFrame frame{}; frame.time = time; frame.baseSpace = space;
  if (meta_) {
    XrEyeGazesInfoFB info{}; info.type = XR_TYPE_EYE_GAZES_INFO_FB; info.time = time; info.baseSpace = space;
    XrEyeGazesFB data{}; data.type = XR_TYPE_EYE_GAZES_FB;
    auto result = getMeta_(meta_, &info, &data);
    if (result != XR_SUCCESS) return result;
    frame.time = data.time; frame.hasConfidence = true;
    for (size_t i = 0; i < 2; ++i) {
      frame.poses[i] = data.gaze[i].gazePose; frame.confidence[i] = data.gaze[i].gazeConfidence;
      frame.valid[i] = data.gaze[i].isValid && poseValid(frame.poses[i]) && weightValid(frame.confidence[i]);
    }
  } else {
    XrEyesGetInfoANDROID info{}; info.type = XR_TYPE_EYES_GET_INFO_ANDROID; info.time = time; info.baseSpace = space;
    XrEyesANDROID data{}; data.type = XR_TYPE_EYES_ANDROID;
    auto result = getAndroid_(android_, &info, &data);
    if (result != XR_SUCCESS) return result;
    for (size_t i = 0; i < 2; ++i) {
      frame.poses[i] = data.eyes[i].eyePose; frame.androidState[i] = data.eyes[i].eyeState;
      const bool tracked = data.mode == XR_EYE_TRACKING_MODE_BOTH_ANDROID ||
        (i == 0 && data.mode == XR_EYE_TRACKING_MODE_LEFT_ANDROID) || (i == 1 && data.mode == XR_EYE_TRACKING_MODE_RIGHT_ANDROID);
      frame.valid[i] = tracked && data.eyes[i].eyeState == XR_EYE_STATE_GAZING_ANDROID && poseValid(frame.poses[i]);
    }
  }
  output = frame; return XR_SUCCESS;
}
}
