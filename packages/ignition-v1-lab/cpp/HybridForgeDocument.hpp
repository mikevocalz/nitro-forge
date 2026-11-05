#pragma once

#include "ForgeRustSession.hpp"
#include "ForgeSerialQueue.hpp"
#include <NitroForgeV1/HybridForgeDocumentSpec.hpp>
#include <atomic>
#include <cstddef>
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

 protected:
  /**
   * Bytes the Rust document owns, reported to the JS GC. Nitro calls this on
   * the JS thread whenever the object crosses to JS, so it only reads a cached
   * value; the document queue re-measures after every operation.
   */
  size_t getExternalMemorySize() noexcept override;

 private:
  const ForgeEngineKind _kind;
  std::shared_ptr<::nitroforge::native::ForgeRustSession> _session;
  /** Every engine call goes through this, so calls reach Rust in call order. */
  std::shared_ptr<::nitroforge::native::ForgeSerialQueue> _queue;
  /** Shared with queued tasks, which may outlive this object. */
  std::shared_ptr<std::atomic<size_t>> _externalMemory;
};

} // namespace margelo::nitro::nitroforge::ignitionv1
