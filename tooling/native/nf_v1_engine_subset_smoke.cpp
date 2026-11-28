// Links the real C++ session against an nf-sys built with only Prism:
//   CARGO_TARGET_DIR=target/prism-only cargo build --locked -p nf-sys
//     --no-default-features --features prism
// Prism opens and works; every other engine fails to open with a clear
// "not linked in this build" error instead of crashing.
#include <NitroForgeV1/ForgeRustSession.hpp>

#include <cassert>
#include <iostream>
#include <stdexcept>
#include <string>
#include <string_view>

using nitroforge::native::ForgeRustSession;

int main() {
  const auto* prism = reinterpret_cast<const uint8_t*>("prism");
  const auto* tally = reinterpret_cast<const uint8_t*>("tally");
  assert(nf_v1_engine_linked(prism, 5) == 1);
  assert(nf_v1_engine_linked(tally, 5) == 0);
  assert(nf_v1_engine_linked(reinterpret_cast<const uint8_t*>("nope"), 4) == -1);

  auto document = ForgeRustSession::open("prism");
  document->apply("new", std::string_view("{\"width\":8,\"height\":8}"));
  assert(document->residentBytes() > 0);
  document->close();

  for (const std::string_view kind : {"tally", "cadence", "scene"}) {
    bool rejected = false;
    try {
      ForgeRustSession::open(kind);
    } catch (const std::runtime_error& error) {
      const std::string message = error.what();
      rejected = message.find("\"code\":\"unsupported\"") != std::string::npos &&
          message.find("not linked in this build (linked: prism)") != std::string::npos;
      if (!rejected) std::cerr << message << std::endl;
    }
    assert(rejected);
  }
  // A failed open leaves the library usable.
  assert(ForgeRustSession::open("prism")->isOpen());

  std::cout << "NitroForge v1 prism-only engine subset smoke passed" << std::endl;
  return 0;
}
