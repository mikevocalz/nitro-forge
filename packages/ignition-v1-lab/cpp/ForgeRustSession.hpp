#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace nitroforge::native {

struct CommandEvent final {
  std::string kind;
  std::optional<std::string> detailJson;
};

struct CommandResult final {
  std::string dataJson;
  std::vector<CommandEvent> events;
};

/**
 * Owns one C FFI document handle and releases it deterministically.
 * All public methods are synchronous native operations. Nitro HybridObjects
 * must call expensive methods from a native worker, never the JS/UI thread.
 *
 * The raw Rust handle never crosses into JavaScript.
 */
class ForgeRustSession final {
 public:
  static std::shared_ptr<ForgeRustSession> open(std::string_view engineKind);
  ~ForgeRustSession() noexcept;

  ForgeRustSession(const ForgeRustSession&) = delete;
  ForgeRustSession& operator=(const ForgeRustSession&) = delete;
  ForgeRustSession(ForgeRustSession&&) = delete;
  ForgeRustSession& operator=(ForgeRustSession&&) = delete;

  CommandResult apply(
      std::string_view operation,
      std::optional<std::string_view> payloadJson = std::nullopt,
      uint32_t commandVersion = 1) const;

  /** Returns an owned NFD1 byte vector. */
  std::vector<uint8_t> snapshot() const;

  /** Restores from readable bytes whose lifetime covers this call. */
  void restore(std::span<const uint8_t> bytes) const;

  /** Idempotent; concurrent operations either complete or reject as closed. */
  void close() noexcept;

  /**
   * False once close() ran. A document the engine terminated after a panic or
   * non-recoverable error stays "open" here until close(); every later call
   * then rejects with the engine's error, so no command runs on it.
   */
  [[nodiscard]] bool isOpen() const noexcept;

 private:
  explicit ForgeRustSession(int64_t handle) noexcept;

  [[nodiscard]] int64_t checkedHandle() const;

  std::atomic<int64_t> _handle;
};

} // namespace nitroforge::native
