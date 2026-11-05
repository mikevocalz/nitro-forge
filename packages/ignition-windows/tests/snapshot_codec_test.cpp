#include "SnapshotCodec.hpp"

#include <iostream>
#include <stdexcept>
#include <string_view>
#include <vector>

int main() {
  using nitroforge::windows::decodeSnapshot;
  using nitroforge::windows::encodeSnapshot;
  try {
    for (const auto text : {std::string_view("Tg=="), std::string_view("TkY="), std::string_view("TkZE"), std::string_view("TkZEMQ==")}) {
      const auto bytes = decodeSnapshot(text);
      if (encodeSnapshot(bytes) != text) throw std::runtime_error("base64 padding or terminator mismatch");
    }
    const std::vector<uint8_t> bytes{0, 1, 127, 128, 254, 255};
    if (decodeSnapshot(encodeSnapshot(bytes)) != bytes) throw std::runtime_error("binary round trip failed");
    bool rejected = false;
    try { (void)decodeSnapshot("!!!!"); } catch (const std::exception&) { rejected = true; }
    if (!rejected) throw std::runtime_error("invalid base64 accepted");
    std::cout << "PASS Win32 snapshot codec: padding, owned bytes, invalid input\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "FAIL Win32 snapshot codec: " << error.what() << '\n';
    return 1;
  }
}
