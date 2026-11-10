#include "nitroforge/xr_tracking.hpp"
#include <cassert>
#include <cstring>
#include <limits>
using namespace nitroforge::persona::xr;
namespace {
int created = 0, destroyed = 0, polled = 0;
bool support = true, valid = true, eyeFollowing = true, paused = false;
bool fineCalled = false;
const char* missing = "";
XrResult createResult = XR_SUCCESS, pollResult = XR_SUCCESS;
XrFaceTrackingDataSource2FB requested = XR_FACE_TRACKING_DATA_SOURCE2_VISUAL_FB;
template<class T> T handle() { return reinterpret_cast<T>(uintptr_t(1)); }
XrResult XRAPI_PTR properties(XrInstance, XrSystemId, XrSystemProperties* p) {
  auto* b = static_cast<XrBaseOutStructure*>(p->next);
  switch(b->type) {
    case XR_TYPE_SYSTEM_FACE_TRACKING_PROPERTIES2_FB: {
      auto* s = reinterpret_cast<XrSystemFaceTrackingProperties2FB*>(b);
      s->supportsVisualFaceTracking = support; s->supportsAudioFaceTracking = support; break;
    }
    case XR_TYPE_SYSTEM_FACE_TRACKING_PROPERTIES_ANDROID:
      reinterpret_cast<XrSystemFaceTrackingPropertiesANDROID*>(b)->supportsFaceTracking = support; break;
    case XR_TYPE_SYSTEM_EYE_TRACKING_PROPERTIES_FB:
      reinterpret_cast<XrSystemEyeTrackingPropertiesFB*>(b)->supportsEyeTracking = support; break;
    case XR_TYPE_SYSTEM_EYE_TRACKING_PROPERTIES_ANDROID:
      reinterpret_cast<XrSystemEyeTrackingPropertiesANDROID*>(b)->supportsEyeTracking = support; break;
    default: assert(false);
  }
  return XR_SUCCESS;
}
XrResult XRAPI_PTR createMeta(XrSession, const XrFaceTrackerCreateInfo2FB* info, XrFaceTracker2FB* h) {
  assert(info->requestedDataSourceCount == 1);
  requested = info->requestedDataSources[0]; ++created;
  if (createResult == XR_SUCCESS) *h = handle<XrFaceTracker2FB>();
  return createResult;
}
XrResult XRAPI_PTR destroyMeta(XrFaceTracker2FB) { ++destroyed; return XR_SUCCESS; }
XrResult XRAPI_PTR getMeta(XrFaceTracker2FB, const XrFaceExpressionInfo2FB* info, XrFaceExpressionWeights2FB* out) {
  ++polled;
  assert(out->weightCount == 70 && out->confidenceCount == 2);
  out->isValid = valid; out->isEyeFollowingBlendshapesValid = eyeFollowing;
  out->dataSource = requested; out->time = info->time - 1;
  out->weights[XR_FACE_EXPRESSION2_TONGUE_OUT_FB] = 0.75f;
  out->weights[XR_FACE_EXPRESSION2_JAW_DROP_FB] = std::numeric_limits<float>::quiet_NaN();
  return pollResult;
}
XrResult XRAPI_PTR createAndroid(XrSession, const XrFaceTrackerCreateInfoANDROID*, XrFaceTrackerANDROID* h) {
  ++created; if (createResult == XR_SUCCESS) *h = handle<XrFaceTrackerANDROID>(); return createResult;
}
XrResult XRAPI_PTR destroyAndroid(XrFaceTrackerANDROID) { ++destroyed; return XR_SUCCESS; }
XrResult XRAPI_PTR getAndroid(XrFaceTrackerANDROID, const XrFaceStateGetInfoANDROID* info, XrFaceStateANDROID* out) {
  ++polled; assert(out->parametersCapacityInput == 68 && out->regionConfidencesCapacityInput == 3);
  out->parametersCountOutput = 68; out->regionConfidencesCountOutput = 3;
  out->isValid = valid; out->faceTrackingState = paused ? XR_FACE_TRACKING_STATE_PAUSED_ANDROID : XR_FACE_TRACKING_STATE_TRACKING_ANDROID;
  out->sampleTime = info->time - 2; out->parameters[XR_FACE_PARAMETER_INDICES_TONGUE_LEFT_ANDROID] = 0.4f;
  return pollResult;
}
XrResult XRAPI_PTR createEyeMeta(XrSession, const XrEyeTrackerCreateInfoFB*, XrEyeTrackerFB* h) {
  ++created; *h = handle<XrEyeTrackerFB>(); return XR_SUCCESS;
}
XrResult XRAPI_PTR destroyEyeMeta(XrEyeTrackerFB) { ++destroyed; return XR_SUCCESS; }
XrResult XRAPI_PTR getEyeMeta(XrEyeTrackerFB, const XrEyeGazesInfoFB* info, XrEyeGazesFB* out) {
  out->time = info->time - 3;
  out->gaze[0].isValid = true; out->gaze[0].gazePose.orientation.w = 1; out->gaze[0].gazeConfidence = 0.9f;
  out->gaze[1].isValid = false; return pollResult;
}
XrResult XRAPI_PTR createEyeAndroid(XrSession, const XrEyeTrackerCreateInfoANDROID*, XrEyeTrackerANDROID* h) {
  ++created; *h = handle<XrEyeTrackerANDROID>(); return XR_SUCCESS;
}
XrResult XRAPI_PTR destroyEyeAndroid(XrEyeTrackerANDROID) { ++destroyed; return XR_SUCCESS; }
XrResult XRAPI_PTR getEyeAndroid(XrEyeTrackerANDROID, const XrEyesGetInfoANDROID*, XrEyesANDROID* out) {
  out->mode = XR_EYE_TRACKING_MODE_LEFT_ANDROID;
  for (auto& e : out->eyes) { e.eyeState = XR_EYE_STATE_GAZING_ANDROID; e.eyePose.orientation.w = 1; }
  return pollResult;
}
XrResult XRAPI_PTR getEyeFine(XrEyeTrackerANDROID h, const XrEyesGetInfoANDROID* info, XrEyesANDROID* out) {
  fineCalled = true; return getEyeAndroid(h, info, out);
}
XrResult XRAPI_PTR resolve(XrInstance, const char* name, PFN_xrVoidFunction* out) {
  if (std::strcmp(missing, name) == 0) return XR_ERROR_FUNCTION_UNSUPPORTED;
#define BIND(symbol, function) if (std::strcmp(name, symbol) == 0) { *out = reinterpret_cast<PFN_xrVoidFunction>(function); return XR_SUCCESS; }
  BIND("xrGetSystemProperties", properties)
  BIND("xrCreateFaceTracker2FB", createMeta)
  BIND("xrDestroyFaceTracker2FB", destroyMeta)
  BIND("xrGetFaceExpressionWeights2FB", getMeta)
  BIND("xrCreateFaceTrackerANDROID", createAndroid)
  BIND("xrDestroyFaceTrackerANDROID", destroyAndroid)
  BIND("xrGetFaceStateANDROID", getAndroid)
  BIND("xrCreateEyeTrackerFB", createEyeMeta)
  BIND("xrDestroyEyeTrackerFB", destroyEyeMeta)
  BIND("xrGetEyeGazesFB", getEyeMeta)
  BIND("xrCreateEyeTrackerANDROID", createEyeAndroid)
  BIND("xrDestroyEyeTrackerANDROID", destroyEyeAndroid)
  BIND("xrGetCoarseTrackingEyesInfoANDROID", getEyeAndroid)
  BIND("xrGetFineTrackingEyesInfoANDROID", getEyeFine)
#undef BIND
  return XR_ERROR_FUNCTION_UNSUPPORTED;
}
}
int main() {
  Context c{handle<XrInstance>(), handle<XrSession>(), 1, resolve,
    {XR_FB_FACE_TRACKING2_EXTENSION_NAME, XR_ANDROID_FACE_TRACKING_EXTENSION_NAME,
     XR_FB_EYE_TRACKING_SOCIAL_EXTENSION_NAME, XR_ANDROID_EYE_TRACKING_EXTENSION_NAME}};
  FaceFrame frame;
  {
    FaceTracker tracker(c, Provider::meta, FaceSource::visual);
    assert(tracker.poll(100, frame) == XR_SUCCESS);
    assert(frame.count == 70 && frame.time == 99 && frame.source == FaceSource::visual);
    assert(frame.weights[XR_FACE_EXPRESSION2_TONGUE_OUT_FB] == 0.75f);
    assert(!frame.valid[XR_FACE_EXPRESSION2_JAW_DROP_FB]);
    eyeFollowing = false; tracker.poll(100, frame);
    assert(!frame.valid[XR_FACE_EXPRESSION2_EYES_LOOK_UP_L_FB]);
    assert(frame.valid[XR_FACE_EXPRESSION2_EYES_CLOSED_L_FB]);
    valid = false; tracker.poll(100, frame); assert(frame.count == 0); valid = true;
    pollResult = XR_ERROR_PERMISSION_INSUFFICIENT;
    assert(tracker.poll(100, frame) == pollResult && frame.count == 0);
    pollResult = XR_SESSION_LOSS_PENDING;
    assert(tracker.poll(100, frame) == pollResult && frame.count == 0);
    pollResult = XR_SUCCESS;
    assert(tracker.close() == XR_SUCCESS); tracker.close();
    assert(tracker.poll(100, frame) == XR_ERROR_HANDLE_INVALID);
  }
  assert(created == 1 && destroyed == 1);
  {
    FaceTracker tracker(c, Provider::meta, FaceSource::audio); tracker.poll(100, frame);
    assert(frame.source == FaceSource::audio);
  }
  {
    FaceTracker tracker(c, Provider::android, FaceSource::unknown); tracker.poll(100, frame);
    assert(frame.count == 68 && frame.time == 98 && frame.source == FaceSource::unknown);
    assert(frame.weights[XR_FACE_PARAMETER_INDICES_TONGUE_LEFT_ANDROID] == 0.4f);
    paused = true; tracker.poll(100, frame); assert(frame.count == 0); paused = false;
  }
  auto expectFailure = [&](XrResult expected) {
    bool failed = false;
    try { FaceTracker tracker(c, Provider::meta, FaceSource::visual); }
    catch (const Error& e) { failed = e.result == expected; }
    assert(failed);
  };
  support = false; expectFailure(XR_ERROR_FEATURE_UNSUPPORTED); support = true;
  missing = "xrGetFaceExpressionWeights2FB"; expectFailure(XR_ERROR_FUNCTION_UNSUPPORTED); missing = "";
  createResult = XR_ERROR_PERMISSION_INSUFFICIENT; expectFailure(createResult); createResult = XR_SUCCESS;
  c.enabledExtensions.erase(c.enabledExtensions.begin()); expectFailure(XR_ERROR_EXTENSION_NOT_PRESENT);
  EyeFrame eyes;
  {
    EyeTracker tracker(c, Provider::meta); tracker.poll(100, handle<XrSpace>(), eyes);
    assert(eyes.time == 97 && eyes.hasConfidence && eyes.valid[0] && !eyes.valid[1]);
    pollResult = XR_ERROR_SESSION_LOST;
    assert(tracker.poll(100, handle<XrSpace>(), eyes) == pollResult && !eyes.valid[0]);
    pollResult = XR_SUCCESS;
  }
  {
    EyeTracker tracker(c, Provider::android, EyePrecision::fine);
    tracker.poll(100, handle<XrSpace>(), eyes);
    assert(fineCalled && eyes.time == 100 && !eyes.hasConfidence && eyes.valid[0] && !eyes.valid[1]);
    tracker.close(); assert(tracker.poll(100, handle<XrSpace>(), eyes) == XR_ERROR_HANDLE_INVALID);
  }
  assert(created == destroyed + 1); // one denied creation, no allocated tracker
}
