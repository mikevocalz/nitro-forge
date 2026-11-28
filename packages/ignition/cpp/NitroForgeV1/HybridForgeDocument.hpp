#pragma once

#include <NitroForgeV1/ForgeRustSession.hpp>
#include <NitroForgeV1/HybridForgeDocumentSpec.hpp>
#include <atomic>
#include <memory>
#include <type_traits>
#include <NitroForgeV1/SerialQueue.hpp>
#include <NitroModules/ThreadPool.hpp>

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
  Promise<ForgeBinaryCommandResult> applyBinary(const ForgeCommand&,const std::optional<ArrayBuffer>&) override;
  std::shared_ptr<HybridForgeTaskSpec> startTask(const ForgeCommand&,const std::optional<ArrayBuffer>&) override;
  Promise<ArrayBuffer> snapshot() override;
  Promise<void> restore(const ArrayBuffer& bytes) override;
  Promise<bool> undo() override;
  Promise<bool> redo() override;
  Promise<void> close() override;

 protected:
  /**
   * The Rust document's resident bytes, undo history included, as of the
   * last queued operation (0 after close). Read from the JS thread without
   * touching the Rust session. Nitro samples it when the document is handed
   * to JS and on NitroModules.updateMemorySize(document).
   */
  size_t getExternalMemorySize() noexcept override {
    return _residentBytes->load(std::memory_order_relaxed);
  }

 private:
  template <typename T, typename Work>
  Promise<T> enqueue(Work work) {
    const auto promise = Promise<T>::pending();
    try {
      // The size is refreshed on the queue after the work, whether it
      // succeeded or failed: a failed command can still close the session.
      _queue.enqueue([promise, work = std::move(work), session = _session, resident = _residentBytes]() {
        const auto refresh = [&]() noexcept { resident->store(session->residentBytes(), std::memory_order_relaxed); };
        try {
          if constexpr (std::is_void_v<T>) { work(); refresh(); promise.resolve(); }
          else { auto value = work(); refresh(); promise.resolve(std::move(value)); }
        } catch (...) { refresh(); promise.reject(std::current_exception()); }
      });
    } catch (...) { promise.reject(std::current_exception()); }
    return promise;
  }
  ::nitroforge::native::SerialQueue _queue { [](std::function<void()> work) {
    ThreadPool::shared().run(std::move(work));
  } };
  const ForgeEngineKind _kind;
  std::shared_ptr<::nitroforge::native::ForgeRustSession> _session;
  // Shared with queued work, which may outlive a call but not the session.
  std::shared_ptr<std::atomic<size_t>> _residentBytes = std::make_shared<std::atomic<size_t>>(0);
};

} // namespace margelo::nitro::nitroforge::ignitionv1
