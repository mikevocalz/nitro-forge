#pragma once

#include "ForgeRustSession.hpp"
#include "ForgeSerialQueue.hpp"
#include <NitroForgeV1/HybridForgeDocumentSpec.hpp>
#include <memory>

namespace margelo::nitro::nitroforge::ignitionv1 {

/** Native C++ implementation of the code-generated Nitro v1 document spec. */
class HybridForgeDocument final : public HybridForgeDocumentSpec {
 public:
  HybridForgeDocument(
      ForgeEngineKind kind,
      std::shared_ptr<::nitroforge::native::ForgeRustSession> session);
  ~HybridForgeDocument() override = default;

  ForgeEngineKind getKind() override;
  Promise<ForgeCommandResult> apply(const ForgeCommand& command) override;
  Promise<ArrayBuffer> snapshot() override;
  Promise<void> restore(const ArrayBuffer& bytes) override;
  Promise<bool> undo() override;
  Promise<bool> redo() override;
  Promise<void> close() override;

 private:
  const ForgeEngineKind _kind;
  std::shared_ptr<::nitroforge::native::ForgeRustSession> _session;
  /** Every engine call goes through this, so calls reach Rust in call order. */
  std::shared_ptr<::nitroforge::native::ForgeSerialQueue> _queue;
};

} // namespace margelo::nitro::nitroforge::ignitionv1
