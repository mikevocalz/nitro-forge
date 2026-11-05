#include "ForgeRustSession.hpp"
#include "nf_v1.h"

#include <cstring>
#include <stdexcept>
#include <utility>

namespace nitroforge::native {
namespace {

class RustError final {
 public:
  explicit RustError(char* error) noexcept : _pointer(error) {}
  RustError(const RustError&) = delete;
  RustError& operator=(const RustError&) = delete;
  ~RustError() { nf_free_string(_pointer); }

  [[nodiscard]] bool present() const noexcept { return _pointer != nullptr; }

  [[nodiscard]] std::string description() const {
    return _pointer == nullptr ? "unknown native error" : std::string(_pointer);
  }

 private:
  char* _pointer;
};

class RustBytes final {
 public:
  explicit RustBytes(NfBytes bytes) noexcept : _bytes(bytes) {}
  RustBytes(const RustBytes&) = delete;
  RustBytes& operator=(const RustBytes&) = delete;
  ~RustBytes() { nf_free_bytes(_bytes); }

  [[nodiscard]] const uint8_t* data() const noexcept { return _bytes.ptr; }
  [[nodiscard]] size_t size() const noexcept { return _bytes.len; }

 private:
  NfBytes _bytes;
};

class RustCommandResult final {
 public:
  explicit RustCommandResult(NfV1CommandResult result) noexcept : _result(result) {}
  RustCommandResult(const RustCommandResult&) = delete;
  RustCommandResult& operator=(const RustCommandResult&) = delete;
  ~RustCommandResult() { nf_v1_free_command_result(_result); }

  [[nodiscard]] bool failed() const noexcept { return _result.error_json != nullptr; }
  [[nodiscard]] std::string error() const {
    return _result.error_json == nullptr ? "unknown command failure" : _result.error_json;
  }

  [[nodiscard]] CommandResult copyToOwned() const {
    if (_result.data_json == nullptr) {
      throw std::runtime_error("Native command succeeded without data JSON");
    }
    if (_result.events == nullptr && _result.event_count != 0) {
      throw std::runtime_error("Native command events array is malformed");
    }
    CommandResult result { std::string(_result.data_json), {} };
    result.events.reserve(_result.event_count);
    for (size_t i = 0; i < _result.event_count; ++i) {
      const auto& event = _result.events[i];
      if (event.kind == nullptr) {
        throw std::runtime_error("Native command event has null kind");
      }
      result.events.push_back({
          std::string(event.kind),
          event.detail_json == nullptr ? std::nullopt
              : std::optional<std::string>(event.detail_json),
      });
    }
    return result;
  }

 private:
  NfV1CommandResult _result;
};

[[noreturn]] void throwNativeError(std::string_view operation, const std::string& description) {
  throw std::runtime_error(std::string(operation) + ": " + description);
}

} // namespace

ForgeRustSession::ForgeRustSession(int64_t handle) noexcept : _handle(handle) {}

std::shared_ptr<ForgeRustSession> ForgeRustSession::open(std::string_view engineKind) {
  if (engineKind.empty() || engineKind.size() > 32) {
    throw std::invalid_argument("Native engine kind must be 1..32 bytes");
  }
  char* error = nullptr;
  const auto handle = nf_v1_open(
      reinterpret_cast<const uint8_t*>(engineKind.data()), engineKind.size(), &error);
  RustError errorGuard(error);
  if (errorGuard.present() || handle <= 0) {
    throwNativeError("open", errorGuard.description());
  }
  return std::shared_ptr<ForgeRustSession>(new ForgeRustSession(handle));
}

ForgeRustSession::~ForgeRustSession() noexcept {
  close();
}

bool ForgeRustSession::isOpen() const noexcept {
  return _handle.load(std::memory_order_acquire) > 0;
}

int64_t ForgeRustSession::checkedHandle() const {
  const auto handle = _handle.load(std::memory_order_acquire);
  if (handle <= 0) {
    throw std::runtime_error("Native document session is closed");
  }
  return handle;
}

CommandResult ForgeRustSession::apply(
    std::string_view operation,
    std::optional<std::string_view> payloadJson,
    uint32_t commandVersion) const {
  if (operation.empty() || operation.size() > 128) {
    throw std::invalid_argument("Native operation must be 1..128 bytes");
  }
  if (payloadJson.has_value() && payloadJson->size() > (32u * 1024u * 1024u)) {
    throw std::invalid_argument("Native payload exceeds 32 MiB");
  }
  const uint8_t* bytes = payloadJson.has_value()
      ? reinterpret_cast<const uint8_t*>(payloadJson->data()) : nullptr;
  const auto size = payloadJson.has_value() ? payloadJson->size() : 0;
  RustCommandResult result(nf_v1_apply_parts(
      checkedHandle(),
      reinterpret_cast<const uint8_t*>(operation.data()), operation.size(),
      bytes, size, commandVersion));
  if (result.failed()) {
    throwNativeError(operation, result.error());
  }
  return result.copyToOwned();
}

std::vector<uint8_t> ForgeRustSession::snapshot() const {
  char* error = nullptr;
  RustBytes bytes(nf_v1_snapshot(checkedHandle(), &error));
  RustError errorGuard(error);
  if (errorGuard.present() || (bytes.data() == nullptr && bytes.size() != 0)) {
    throwNativeError("snapshot", errorGuard.description());
  }
  if (bytes.size() == 0) {
    return {};
  }
  return std::vector<uint8_t>(bytes.data(), bytes.data() + bytes.size());
}

void ForgeRustSession::restore(std::span<const uint8_t> bytes) const {
  if (bytes.empty() || bytes.size() > (256u * 1024u * 1024u)) {
    throw std::invalid_argument("Native snapshot must be 1..256 MiB");
  }
  RustError error(nf_v1_restore(checkedHandle(), bytes.data(), bytes.size()));
  if (error.present()) {
    throwNativeError("restore", error.description());
  }
}

size_t ForgeRustSession::documentSize() const noexcept {
  const auto handle = _handle.load(std::memory_order_acquire);
  return handle > 0 ? nf_v1_document_size(handle) : 0;
}

void ForgeRustSession::close() noexcept {
  const int64_t handle = _handle.exchange(0, std::memory_order_acq_rel);
  if (handle > 0) {
    (void) nf_v1_close(handle);
  }
}

} // namespace nitroforge::native
