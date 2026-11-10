#pragma once
#include "nitroforge/xr_tracking.hpp"
#include "nitroforge/persona.hpp"
#include "nitroforge/tracking.hpp"
#include <limits>

namespace nitroforge::persona::xr {
// XrTime is nanoseconds in an opaque runtime epoch. Anchor it to the host's
// session clock; do not cast absolute ticks to double before subtraction.
class SessionClock final {
 public:
  SessionClock(XrTime anchor, double seconds) : anchor_(anchor), seconds_(seconds) {
    if (anchor <= 0 || !std::isfinite(seconds)) throw std::invalid_argument("invalid XR clock anchor");
  }
  double seconds(XrTime ticks) const {
    if (ticks <= 0) throw std::invalid_argument("invalid XR sample time");
    // Both operands are positive int64 values, so their difference cannot overflow.
    const XrDuration delta = ticks - anchor_;
    const double value = seconds_ + static_cast<double>(delta) / 1000000000.0;
    if (!std::isfinite(value)) throw std::invalid_argument("XR clock overflow");
    return value;
  }
 private:
  XrTime anchor_;
  double seconds_;
};
struct RigFrame { FaceSource source; TrackingSample controls; };
// Construct once per asset/provider calibration. Host serializes capture/map.
class FaceRig final {
 public:
  FaceRig(Provider provider, Calibration calibration) : provider_(provider), calibration_(std::move(calibration)) {
    calibration_.validate();
    const auto count = provider == Provider::meta ? XR_FACE_EXPRESSION2_COUNT_FB :
                       provider == Provider::android ? XR_FACE_PARAMETER_COUNT_ANDROID : 0;
    if (calibration_.sourceCount != static_cast<uint32_t>(count))
      throw std::invalid_argument("calibration does not match vendor channel layout");
  }
  RigFrame map(const FaceFrame& frame, const SessionClock& clock) const {
    if (frame.provider != provider_) throw std::invalid_argument("wrong tracking provider");
    RigFrame output{frame.source, {0, std::vector<float>(calibration_.targetCount), std::vector<bool>(calibration_.targetCount, false)}};
    if (frame.count == 0) return output; // invalid/pause/error clears all targets
    if (frame.count != calibration_.sourceCount) throw std::invalid_argument("wrong face channel count");
    output.controls.seconds = clock.seconds(frame.time);
    for (size_t i = 0; i < calibration_.targetCount; ++i) {
      double value = calibration_.bias[i];
      bool valid = true, mapped = false;
      for (size_t j = 0; j < calibration_.sourceCount; ++j) {
        const float coefficient = calibration_.matrix[i * calibration_.sourceCount + j];
        if (coefficient == 0) continue;
        mapped = true;
        if (!frame.valid[j] || !std::isfinite(frame.weights[j])) { valid = false; break; }
        value += double(coefficient) * frame.weights[j];
      }
      // Bias-only/unmapped rows must not claim measured control over audio.
      if (!valid || !mapped || !std::isfinite(value)) continue;
      output.controls.weights[i] = static_cast<float>(std::clamp(value, double(calibration_.minimum[i]), double(calibration_.maximum[i])));
      output.controls.valid[i] = true;
    }
    return output;
  }
 private:
  Provider provider_;
  Calibration calibration_;
};
// Unknown provenance is deliberately not promoted to measured tracking. The
// Android data-source extension must identify it before automatic fusion.
inline FusedControls selectFaceControls(const std::vector<float>& neutral,
                                       const RigFrame& face,
                                       const TrackingSample* audio,
                                       double now, double maximumAge) {
  if (face.source == FaceSource::visual)
    return selectControls(neutral, &face.controls, audio, now, maximumAge);
  if (face.source == FaceSource::audio) {
    auto result = selectControls(neutral, nullptr, audio, now, maximumAge);
    auto vendorAudio = selectControls(neutral, nullptr, &face.controls, now, maximumAge);
    for (size_t i = 0; i < neutral.size(); ++i)
      if (result.origins[i] == ControlOrigin::neutral && vendorAudio.origins[i] == ControlOrigin::audio) {
        result.weights[i] = vendorAudio.weights[i]; result.origins[i] = ControlOrigin::audio;
      }
    return result;
  }
  return selectControls(neutral, nullptr, audio, now, maximumAge);
}
}
