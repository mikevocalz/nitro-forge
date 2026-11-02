#include "HybridForgeDocument.hpp"

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
  return Promise<ForgeCommandResult>::async([session, request]() {
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
  return Promise<ArrayBuffer>::async([session]() {
    return ArrayBuffer::move(session->snapshot());
  });
}

Promise<void> HybridForgeDocument::restore(const ArrayBuffer& bytes) {
  // JS-backed buffers may become invalid after leaving the JS runtime.
  // Retain an owned copy or owner before scheduling the background operation.
  ArrayBuffer owned = bytes.asOwning();
  const auto session = _session;
  return Promise<void>::async([session, owned]() {
    session->restore(std::span<const uint8_t>(owned.data(), owned.size()));
  });
}

Promise<bool> HybridForgeDocument::undo() {
  const auto session = _session;
  return Promise<bool>::async([session]() {
    const auto result = session->apply("__undo");
    if (result.dataJson == "{\"undone\":true}") return true;
    if (result.dataJson == "{\"undone\":false}") return false;
    throw std::runtime_error("Invalid native undo response");
  });
}

Promise<bool> HybridForgeDocument::redo() {
  const auto session = _session;
  return Promise<bool>::async([session]() {
    const auto result = session->apply("__redo");
    if (result.dataJson == "{\"redone\":true}") return true;
    if (result.dataJson == "{\"redone\":false}") return false;
    throw std::runtime_error("Invalid native redo response");
  });
}

Promise<void> HybridForgeDocument::close() {
  const auto session = _session;
  return Promise<void>::async([session]() { session->close(); });
}

} // namespace margelo::nitro::nitroforge::ignitionv1
