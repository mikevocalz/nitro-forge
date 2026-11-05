#include "SnapshotCodec.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <Windows.h>
#include <wincrypt.h>

#include <stdexcept>

namespace nitroforge::windows {
namespace {
constexpr size_t maxSnapshotBytes = 256u * 1024u * 1024u;
constexpr size_t maxEncodedBytes = 4u * ((maxSnapshotBytes + 2u) / 3u);
}

std::string encodeSnapshot(std::span<const uint8_t> bytes) {
  if (bytes.empty() || bytes.size() > maxSnapshotBytes) {
    throw std::invalid_argument("Snapshot must be 1..256 MiB");
  }
  DWORD length = 0;
  const auto size = static_cast<DWORD>(bytes.size());
  constexpr DWORD flags = CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF;
  if (!CryptBinaryToStringA(bytes.data(), size, flags, nullptr, &length)) {
    throw std::runtime_error("Cannot measure snapshot encoding");
  }
  std::string text(length, '\0');
  if (!CryptBinaryToStringA(bytes.data(), size, flags, text.data(), &length)) {
    throw std::runtime_error("Cannot encode snapshot");
  }
  // The measured capacity includes the terminator; the second call's length
  // excludes it. No caller observes that extra byte.
  text.resize(length);
  return text;
}

std::vector<uint8_t> decodeSnapshot(std::string_view text) {
  if (text.empty() || text.size() > maxEncodedBytes) {
    throw std::invalid_argument("Encoded snapshot exceeds the native size limit");
  }
  DWORD length = 0;
  const auto size = static_cast<DWORD>(text.size());
  constexpr DWORD flags = CRYPT_STRING_BASE64 | CRYPT_STRING_STRICT;
  if (!CryptStringToBinaryA(text.data(), size, flags, nullptr, &length, nullptr, nullptr) ||
      length == 0 || length > maxSnapshotBytes) {
    throw std::invalid_argument("Invalid snapshot base64");
  }
  std::vector<uint8_t> bytes(length);
  if (!CryptStringToBinaryA(text.data(), size, flags, bytes.data(), &length, nullptr, nullptr)) {
    throw std::invalid_argument("Invalid snapshot base64");
  }
  bytes.resize(length);
  return bytes;
}

} // namespace nitroforge::windows
