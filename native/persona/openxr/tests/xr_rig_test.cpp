#include "nitroforge/xr_rig.hpp"
#include "nitroforge/rigged_splats.hpp"
#include <cassert>
#include <limits>
using namespace nitroforge::persona;
using namespace nitroforge::persona::xr;
int main() {
  constexpr XrTime anchor = 8000000000000000000LL;
  SessionClock clock(anchor, 10);
  assert(std::abs(clock.seconds(anchor + 1000000) - 10.001) < 1e-12);
  assert(std::abs(clock.seconds(anchor - 1000000) - 9.999) < 1e-12);
  Calibration calibration{70, 3, std::vector<float>(210), {0,0,0.5f}, {0,0,0}, {1,1,1}};
  calibration.matrix[XR_FACE_EXPRESSION2_JAW_DROP_FB] = 1;
  calibration.matrix[70 + XR_FACE_EXPRESSION2_TONGUE_OUT_FB] = 2;
  FaceRig rig(Provider::meta, calibration);
  FaceFrame frame{}; frame.provider = Provider::meta; frame.source = FaceSource::visual;
  frame.count = 70; frame.time = anchor;
  frame.valid.fill(true); frame.weights[XR_FACE_EXPRESSION2_TONGUE_OUT_FB] = 0.75f;
  frame.weights[1] = std::numeric_limits<float>::quiet_NaN(); // unrelated input cannot poison targets
  auto mapped = rig.map(frame, clock);
  assert(mapped.controls.weights[0] == 0 && mapped.controls.weights[1] == 1);
  assert(mapped.controls.valid[0] && mapped.controls.valid[1] && !mapped.controls.valid[2]);
  TrackingSample audio{10, {0.8f,0.2f,0.3f}, {true,true,true}};
  auto fused = selectFaceControls({0,0,0}, mapped, &audio, 10.01, 0.1);
  assert(fused.weights == std::vector<float>({0,1,0.3f}));
  // Complete CPU path: captured tongue channel -> calibrated controls -> mesh
  // expression -> bound Gaussian center/covariance. No image fitting is implied.
  BoundSplat splat{{1,0,0}, {0,0,0}, {{1,0,0,0,1,0,0,0,1}}};
  RiggedSplats mesh({{0,0,0},{1,0,0},{0,1,0}}, {{{0,1,2}}},
                   {{}, {{0,{0,0,1}},{1,{0,0,1}},{2,{0,0,1}}}, {}}, {{0,splat}});
  auto animated = mesh.evaluate(fused.weights);
  assert(animated.size() == 1 && animated[0].center.z == 1);
  assert(animated[0].covariance.v[0] == 1 && animated[0].covariance.v[8] == 1);
  assert(mesh.evaluate({0,0,0})[0].center.z == 0);
  bool invalidRig = false;
  try { mesh.evaluate({0,std::numeric_limits<float>::quiet_NaN(),0}); }
  catch (const std::invalid_argument&) { invalidRig = true; }
  assert(invalidRig && mesh.evaluate({0,0,0})[0].center.z == 0);

  frame.valid[XR_FACE_EXPRESSION2_JAW_DROP_FB] = false;
  mapped = rig.map(frame, clock);
  assert(selectFaceControls({0,0,0}, mapped, &audio, 10.01, 0.1).weights[0] == 0.8f);
  mapped.source = FaceSource::audio;
  assert(selectFaceControls({0,0,0}, mapped, &audio, 10.01, 0.1).weights == audio.weights);
  audio.valid[1] = false;
  assert(selectFaceControls({0,0,0}, mapped, &audio, 10.01, 0.1).weights[1] == 1);
  mapped.source = FaceSource::unknown;
  assert(selectFaceControls({0,0,0}, mapped, &audio, 10.01, 0.1).weights[1] == 0);
  mapped.source = FaceSource::visual;
  assert(selectFaceControls({0,0,0}, mapped, &audio, 11, 0.1).weights == std::vector<float>({0,0,0}));
  frame.count = 0; mapped = rig.map(frame, clock);
  for (bool valid : mapped.controls.valid) assert(!valid);
  frame.count = 68;
  bool rejected = false;
  try { rig.map(frame, clock); } catch (const std::invalid_argument&) { rejected = true; }
  assert(rejected);
}
