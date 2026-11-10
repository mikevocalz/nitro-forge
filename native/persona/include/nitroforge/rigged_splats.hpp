#pragma once
#include "nitroforge/persona.hpp"
#include <array>
#include <utility>

namespace nitroforge::persona {
struct VertexDelta { uint32_t vertex; Vec3 delta; };
struct SplatBinding { uint32_t triangle; BoundSplat splat; };
// CPU reference deformation pipeline for fitted assets. The asset supplies the
// neutral mesh, sparse expression deltas and canonical splat bindings. This is
// not GNM fitting, GPU rasterization, or a production million-splat frame loop.
class RiggedSplats final {
 public:
  RiggedSplats(std::vector<Vec3> neutral, std::vector<std::array<uint32_t, 3>> triangles,
               std::vector<std::vector<VertexDelta>> controls, std::vector<SplatBinding> bindings)
      : neutral_(std::move(neutral)), triangles_(std::move(triangles)),
        controls_(std::move(controls)), bindings_(std::move(bindings)) {
    if (neutral_.empty() || controls_.empty() || controls_.size() > 1024)
      throw std::invalid_argument("invalid rig dimensions");
    for (const auto& vertex : neutral_) check(vertex);
    for (const auto& triangle : triangles_)
      for (auto index : triangle)
        if (index >= neutral_.size()) throw std::invalid_argument("triangle vertex out of range");
    for (const auto& control : controls_)
      for (const auto& delta : control) {
        if (delta.vertex >= neutral_.size()) throw std::invalid_argument("delta vertex out of range");
        check(delta.delta);
      }
    for (const auto& binding : bindings_) {
      if (binding.triangle >= triangles_.size()) throw std::invalid_argument("binding triangle out of range");
      const auto& t = triangles_[binding.triangle];
      const Vec3 triangle[3]{neutral_[t[0]], neutral_[t[1]], neutral_[t[2]]};
      deform(binding.splat, triangle); // validates rest frame, binding and covariance
    }
  }
  std::vector<DeformedSplat> evaluate(const std::vector<float>& weights) const {
    if (weights.size() != controls_.size()) throw std::invalid_argument("rig control count mismatch");
    auto vertices = neutral_;
    for (size_t i = 0; i < weights.size(); ++i) {
      if (!std::isfinite(weights[i])) throw std::invalid_argument("invalid rig weight");
      for (const auto& d : controls_[i]) {
        auto& v = vertices[d.vertex];
        v.x += weights[i] * d.delta.x;
        v.y += weights[i] * d.delta.y;
        v.z += weights[i] * d.delta.z;
      }
    }
    for (const auto& vertex : vertices) check(vertex);
    std::vector<DeformedSplat> output;
    output.reserve(bindings_.size());
    for (const auto& binding : bindings_) {
      const auto& t = triangles_[binding.triangle];
      const Vec3 triangle[3]{vertices[t[0]], vertices[t[1]], vertices[t[2]]};
      output.push_back(deform(binding.splat, triangle));
    }
    return output; // no partially updated mesh is published on invalid deformation
  }
 private:
  static void check(const Vec3& v) {
    if (!std::isfinite(v.x) || !std::isfinite(v.y) || !std::isfinite(v.z))
      throw std::invalid_argument("invalid rig vertex");
  }
  std::vector<Vec3> neutral_;
  std::vector<std::array<uint32_t, 3>> triangles_;
  std::vector<std::vector<VertexDelta>> controls_;
  std::vector<SplatBinding> bindings_;
};
}
