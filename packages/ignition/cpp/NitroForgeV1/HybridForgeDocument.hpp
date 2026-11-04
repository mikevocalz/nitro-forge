#pragma once

#include <NitroForgeV1/ForgeRustSession.hpp>
#include <NitroForgeV1/HybridForgeDocumentSpec.hpp>
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
  Promise<ArrayBuffer> snapshot() override;
  Promise<void> restore(const ArrayBuffer& bytes) override;
  Promise<bool> undo() override;
  Promise<bool> redo() override;
  Promise<void> close() override;

 private:
  template <typename T, typename Work>
  Promise<T> enqueue(Work work) {
    const auto promise = Promise<T>::pending();
    try {
      _queue.enqueue([promise, work = std::move(work)]() {
        try {
          if constexpr (std::is_void_v<T>) { work(); promise.resolve(); }
          else { promise.resolve(work()); }
        } catch (...) { promise.reject(std::current_exception()); }
      });
    } catch (...) { promise.reject(std::current_exception()); }
    return promise;
  }
  ::nitroforge::native::SerialQueue _queue { [](std::function<void()> work) {
    ThreadPool::shared().run(std::move(work));
  } };
  const ForgeEngineKind _kind;
  std::shared_ptr<::nitroforge::native::ForgeRustSession> _session;
};

} // namespace margelo::nitro::nitroforge::ignitionv1
