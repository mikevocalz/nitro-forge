#include "nitroforge/tracking.hpp"
#include <cassert>
#include <limits>
using namespace nitroforge::persona;
int main() {
  const std::vector<float> neutral{0, 0, 0};
  TrackingSample audio{10, {0.8f, 0.7f, 0.6f}, {true, true, true}};
  TrackingSample sensor{10, {0, 0.9f, 1}, {true, false, true}};
  auto result = selectControls(neutral, &sensor, &audio, 10, 0.1);
  assert(result.weights == std::vector<float>({0, 0.7f, 1}));
  assert(result.origins[0] == ControlOrigin::tracked);
  assert(result.origins[1] == ControlOrigin::audio);
  sensor.seconds = 9;
  assert(selectControls(neutral, &sensor, &audio, 10, 0.1).weights == audio.weights);
  sensor.seconds = 11;
  assert(selectControls(neutral, &sensor, nullptr, 10, 0.1).weights == neutral);
  sensor.seconds = 10;
  sensor.weights[0] = std::numeric_limits<float>::quiet_NaN();
  assert(selectControls(neutral, &sensor, &audio, 10, 0.1).weights[0] == 0.8f);
  assert(selectControls(neutral, &sensor, &audio, 12, 0.1).weights == neutral);
  sensor.valid.clear();
  bool rejected = false;
  try { selectControls(neutral, &sensor, &audio, 10, 0.1); }
  catch (const std::invalid_argument&) { rejected = true; }
  assert(rejected);
}
