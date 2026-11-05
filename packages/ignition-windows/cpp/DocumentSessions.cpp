#include "DocumentSessions.hpp"

#include <limits>
#include <stdexcept>
#include <utility>

namespace nitroforge::windows {

std::string DocumentSessions::open(std::string_view kind) {
  if (_nextToken == std::numeric_limits<uint64_t>::max()) {
    throw std::overflow_error("Windows document token space exhausted");
  }
  auto session = native::ForgeRustSession::open(kind);
  auto token = std::to_string(_nextToken++);
  _documents.emplace(token, std::move(session));
  return token;
}

native::ForgeRustSession& DocumentSessions::at(const std::string& token) {
  const auto found = _documents.find(token);
  if (found == _documents.end()) {
    throw std::invalid_argument("Windows document is closed or unknown");
  }
  return *found->second;
}

bool DocumentSessions::close(const std::string& token) noexcept {
  return _documents.erase(token) != 0;
}

} // namespace nitroforge::windows
