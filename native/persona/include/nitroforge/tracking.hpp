#pragma once
#include <cmath>
#include <stdexcept>
#include <vector>

namespace nitroforge::persona {
// Inputs must already be mapped into the same calibrated rig channel layout.
// Times use the host's monotonic session clock, not raw vendor clock ticks.
enum class ControlOrigin { neutral, audio, tracked };
struct TrackingSample {
  double seconds;
  std::vector<float> weights;
  std::vector<bool> valid;
};
struct FusedControls {
  std::vector<float> weights;
  std::vector<ControlOrigin> origins;
};
// Stateless reference selector. Caller synchronizes provider snapshots. A valid
// measured zero overrides audio just as a nonzero sample does. Invalid, stale,
// future and unsupported channels cannot freeze the last facial expression.
inline FusedControls selectControls(const std::vector<float>& neutral,
                                    const TrackingSample* tracked,
                                    const TrackingSample* audio,
                                    double now, double maximumAge) {
  if (!std::isfinite(now) || !std::isfinite(maximumAge) || maximumAge < 0)
    throw std::invalid_argument("invalid tracking clock or maximum age");
  for (float v : neutral)
    if (!std::isfinite(v)) throw std::invalid_argument("invalid neutral control");
  auto check = [&](const TrackingSample* sample) {
    if (sample && (sample->weights.size() != neutral.size() ||
                   sample->valid.size() != neutral.size()))
      throw std::invalid_argument("tracking rig layout mismatch");
  };
  check(tracked); check(audio);
  FusedControls result{neutral, std::vector<ControlOrigin>(neutral.size(), ControlOrigin::neutral)};
  auto apply = [&](const TrackingSample* sample, ControlOrigin origin) {
    if (!sample || !std::isfinite(sample->seconds) || sample->seconds > now ||
        now - sample->seconds > maximumAge) return;
    for (size_t i = 0; i < neutral.size(); ++i)
      if (sample->valid[i] && std::isfinite(sample->weights[i])) {
        result.weights[i] = sample->weights[i];
        result.origins[i] = origin;
      }
  };
  apply(audio, ControlOrigin::audio);
  apply(tracked, ControlOrigin::tracked);
  return result;
}
}
