#pragma once

#include <cstdint>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace nitroforge::windows {

// RNW's attributed-module transport does not expose the Nitro ArrayBuffer ABI.
// Encoding is deliberately internal; EngineHost still takes/returns bytes.
[[nodiscard]] std::string encodeSnapshot(std::span<const uint8_t> bytes);
[[nodiscard]] std::vector<uint8_t> decodeSnapshot(std::string_view text);

} // namespace nitroforge::windows
