#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <deque>
#include <mutex>
#include <stdexcept>
#include <vector>

namespace nitroforge::persona {
// These are calibrated target controls, not assumed ARKit/GNM index equivalence.
struct Calibration {
  uint32_t sourceCount, targetCount;
  std::vector<float> matrix, bias, minimum, maximum;
  void validate() const;
  std::vector<float> map(const std::vector<float>& source) const;
};
struct Frame { double seconds; std::vector<float> weights; };
// A bounded, native-owned performance buffer. Time is the final audio clip's
// playback time; no wall-clock drift and no JS frame loop. Host owns audio I/O.
class Performance final {
 public:
  Performance(Calibration calibration, size_t capacity, double maximumGap);
  void append(const Frame& frame);
  std::vector<float> sample(double seconds) const;
  void reset();
  void close();
 private:
  Calibration calibration_;
  size_t capacity_;
  double maximumGap_;
  mutable std::mutex mutex_;
  bool closed_ = false;
  std::deque<Frame> frames_;
};
struct Vec3 { double x, y, z; };
struct Mat3 { double v[9]; }; // row major
struct BoundSplat {
  double barycentric[3];
  Vec3 localOffset;
  Mat3 localCovariance;
};
struct DeformedSplat { Vec3 center; Mat3 covariance; };
// Local frame columns: triangle edge 01, edge 02, unit surface normal.
// Offset/covariance must be expressed in that frame at binding time.
// CPU reference math for a future WGSL implementation, not a rasterizer.
DeformedSplat deform(const BoundSplat&, const Vec3 (&triangle)[3]);
}
