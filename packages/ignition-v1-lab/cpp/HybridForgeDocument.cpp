#include "HybridForgeDocument.hpp"

#include <NitroModules/ThreadPool.hpp>

#include <cmath>
#include <cstdint>
#include <limits>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <type_traits>
#include <utility>
#include <vector>

namespace margelo::nitro::nitroforge::ignitionv1 {

namespace {

using ::nitroforge::native::ForgeSerialQueue;

std::shared_ptr<ForgeSerialQueue> makeDocumentQueue() {
  return ForgeSerialQueue::create(
      [](ForgeSerialQueue::Task task) { ThreadPool::shared().run(std::move(task)); });
}

/** Like Promise::async, but ordered behind every earlier call on this document. */
template <typename TResult, typename Run>
Promise<TResult> enqueue(ForgeSerialQueue& queue, Run&& run) {
  auto promise = Promise<TResult>::pending();
  queue.submit([promise, run = std::forward<Run>(run)]() mutable {
    try {
      if constexpr (std::is_void_v<TResult>) {
        run();
        promise.resolve();
      } else {
        promise.resolve(run());
      }
    } catch (...) {
      promise.reject(std::current_exception());
    }
  });
  return promise;
}

} // namespace

HybridForgeDocument::HybridForgeDocument(
    ForgeEngineKind kind,
    std::shared_ptr<::nitroforge::native::ForgeRustSession> session)
    : _kind(kind), _session(std::move(session)), _queue(makeDocumentQueue()) {
  if (!_session || !_session->isOpen()) {
    throw std::invalid_argument("ForgeDocument requires an open Rust document");
  }
}

ForgeEngineKind HybridForgeDocument::getKind() {
  return _kind;
}

Promise<ForgeCommandResult> HybridForgeDocument::apply(const ForgeCommand& command) {
  const auto session = _session;
  const ForgeCommand request = command;
  return enqueue<ForgeCommandResult>(*_queue, [session, request]() {
    uint32_t version = 1;
    if (request.v.has_value()) {
      const double candidate = *request.v;
      if (!std::isfinite(candidate) || candidate < 1.0 ||
          candidate > static_cast<double>(std::numeric_limits<uint32_t>::max()) ||
          std::trunc(candidate) != candidate) {
        throw std::invalid_argument("Invalid Ignition command schema version");
      }
      version = static_cast<uint32_t>(candidate);
    }
    std::optional<std::string_view> payload;
    if (request.payloadJson) {
      payload = std::string_view(*request.payloadJson);
    }
    auto native = session->apply(request.op, payload, version);
    std::vector<ForgeEvent> events;
    events.reserve(native.events.size());
    for (auto& item : native.events) {
      events.emplace_back(std::move(item.kind), std::move(item.detailJson));
    }
    return ForgeCommandResult(std::move(native.dataJson), std::move(events));
  });
}

Promise<ArrayBuffer> HybridForgeDocument::snapshot() {
  const auto session = _session;
  return enqueue<ArrayBuffer>(*_queue, [session]() {
    return ArrayBuffer::move(session->snapshot());
  });
}

Promise<void> HybridForgeDocument::restore(const ArrayBuffer& bytes) {
  // JS-backed buffers may become invalid after leaving the JS runtime.
  // Retain an owned copy or owner before scheduling the background operation.
  ArrayBuffer owned = bytes.asOwning();
  const auto session = _session;
  return enqueue<void>(*_queue, [session, owned]() {
    session->restore(std::span<const uint8_t>(owned.data(), owned.size()));
  });
}

Promise<bool> HybridForgeDocument::undo() {
  const auto session = _session;
  return enqueue<bool>(*_queue, [session]() {
    const auto result = session->apply("__undo");
    if (result.dataJson == "{\"undone\":true}") return true;
    if (result.dataJson == "{\"undone\":false}") return false;
    throw std::runtime_error("Invalid native undo response");
  });
}

Promise<bool> HybridForgeDocument::redo() {
  const auto session = _session;
  return enqueue<bool>(*_queue, [session]() {
    const auto result = session->apply("__redo");
    if (result.dataJson == "{\"redone\":true}") return true;
    if (result.dataJson == "{\"redone\":false}") return false;
    throw std::runtime_error("Invalid native redo response");
  });
}

Promise<void> HybridForgeDocument::close() {
  const auto session = _session;
  return enqueue<void>(*_queue, [session]() { session->close(); });
}

} // namespace margelo::nitro::nitroforge::ignitionv1
