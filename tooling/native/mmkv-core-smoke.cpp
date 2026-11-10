// Actual Tencent MMKVCore 2.4.0 subprocess round trip. No Nitro/JS mock.
#include "MMKV.h"
#include "MMBuffer.h"
#include <algorithm>
#include <array>
#include <cstring>
#include <iostream>
#include <stdexcept>

int main(int argc, char** argv) {
  if (argc != 3) throw std::runtime_error("Usage: mmkv-core-smoke DIRECTORY write|read");
  MMKV::initializeMMKV(argv[1], MMKVLogNone);
  const bool writing = std::strcmp(argv[2], "write") == 0;
  if (!writing && !MMKV::checkExist("board-checkpoint")) throw std::runtime_error("No persistent MMKV instance after subprocess restart");
  auto* storage = MMKV::mmkvWithID("board-checkpoint", MMKVConfig{});
  if (!storage) throw std::runtime_error("MMKV creation failed");
  const std::array<unsigned char, 5> expected{0, 1, 127, 128, 255};
  if (writing) {
    auto input = expected;
    mmkv::MMBuffer buffer(input.data(), input.size(), mmkv::MMBufferNoCopy);
    if (!storage->set(std::move(buffer), "binary")) throw std::runtime_error("MMKV write failed");
    input.fill(42);
  }
  mmkv::MMBuffer result;
  if (!storage->getBytes("binary", result) || result.length() != expected.size() ||
      std::memcmp(result.getPtr(), expected.data(), expected.size()) != 0)
    throw std::runtime_error("MMKV payload changed across write or subprocess restart");
  std::memset(result.getPtr(), 91, result.length());
  mmkv::MMBuffer second;
  if (!storage->getBytes("binary", second) || std::memcmp(second.getPtr(), expected.data(), expected.size()) != 0)
    throw std::runtime_error("MMKV read returned borrowed mutable storage");
  storage->close();
  std::cout << "MMKV_CORE_2_4_0_" << (writing ? "WRITE" : "REOPEN") << "_PASS\n";
}
