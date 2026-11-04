#include <NitroForgeV1/HybridForgeDocument.hpp>

#include <cmath>
#include <cstdint>
#include <limits>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace margelo::nitro::nitroforge::ignitionv1 {

HybridForgeDocument::HybridForgeDocument(
    ForgeEngineKind kind,
    std::shared_ptr<::nitroforge::native::ForgeRustSession> session)
    : _kind(kind), _session(std::move(session)) {
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
  return enqueue<ForgeCommandResult>([session, request]() {
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
  return enqueue<ArrayBuffer>([session]() {
    return ArrayBuffer::move(session->snapshot());
  });
}

Promise<void> HybridForgeDocument::restore(const ArrayBuffer& bytes) {
  // Retaining native backing storage is insufficient: JS can still mutate it.
  // Copy synchronously before leaving the runtime, bounded like the Rust ABI.
  if (bytes.size() > 256u * 1024u * 1024u) {
    return Promise<void>::rejected(std::make_exception_ptr(std::invalid_argument("Snapshot exceeds 256 MiB")));
  }
  ArrayBuffer owned = ArrayBuffer::copy(bytes);
  const auto session = _session;
  return enqueue<void>([session, owned]() {
    session->restore(std::span<const uint8_t>(owned.data(), owned.size()));
  });
}

Promise<bool> HybridForgeDocument::undo() {
  const auto session = _session;
  return enqueue<bool>([session]() {
    const auto result = session->apply("__undo");
    if (result.dataJson == "{\"undone\":true}") return true;
    if (result.dataJson == "{\"undone\":false}") return false;
    throw std::runtime_error("Invalid native undo response");
  });
}

Promise<bool> HybridForgeDocument::redo() {
  const auto session = _session;
  return enqueue<bool>([session]() {
    const auto result = session->apply("__redo");
    if (result.dataJson == "{\"redone\":true}") return true;
    if (result.dataJson == "{\"redone\":false}") return false;
    throw std::runtime_error("Invalid native redo response");
  });
}

Promise<void> HybridForgeDocument::close() {
  const auto session = _session;
  return enqueue<void>([session]() { session->close(); });
}

} // namespace margelo::nitro::nitroforge::ignitionv1
