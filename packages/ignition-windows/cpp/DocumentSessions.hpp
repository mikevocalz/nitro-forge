#pragma once

#include "ForgeRustSession.hpp"

#include <cstdint>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>

namespace nitroforge::windows {

// Accessed only by ForgeWorker. These tokens are unrelated to Rust FFI handles.
class DocumentSessions final {
 public:
  [[nodiscard]] std::string open(std::string_view kind);
  [[nodiscard]] native::ForgeRustSession& at(const std::string& token);
  [[nodiscard]] bool close(const std::string& token) noexcept;

 private:
  uint64_t _nextToken{1};
  std::unordered_map<std::string, std::shared_ptr<native::ForgeRustSession>> _documents;
};

} // namespace nitroforge::windows
