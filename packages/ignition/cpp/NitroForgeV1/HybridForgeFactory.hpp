#pragma once

#include <NitroForgeV1/HybridForgeFactorySpec.hpp>

namespace margelo::nitro::nitroforge::ignitionv1 {

/** Native v1 factory, intentionally lightweight; opens sessions on a worker. */
class HybridForgeFactory final : public HybridForgeFactorySpec {
 public:
  HybridForgeFactory() = default;
  ~HybridForgeFactory() override = default;

  Promise<std::shared_ptr<HybridForgeDocumentSpec>> open(ForgeEngineKind kind) override;
};

} // namespace margelo::nitro::nitroforge::ignitionv1
