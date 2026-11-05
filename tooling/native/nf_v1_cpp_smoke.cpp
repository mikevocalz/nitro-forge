#include "../../packages/ignition-v1-lab/cpp/ForgeRustSession.hpp"

#include <cassert>
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <string>
#include <string_view>

using nitroforge::native::ForgeRustSession;

int main() {
  auto document = ForgeRustSession::open("tally");
  assert(document->isOpen());
  document->apply("new", std::string_view("{}"));
  document->apply("setCell", std::string_view("{\"addr\":\"A1\",\"value\":\"42\"}"));

  auto source = document->snapshot();
  assert(source.size() >= 9);
  assert(std::memcmp(source.data(), "NFD1", 4) == 0);

  document->apply("setCell", std::string_view("{\"addr\":\"A1\",\"value\":\"8\"}"));
  document->restore(source);
  auto restored = document->apply("getCell", std::string_view("{\"addr\":\"A1\"}"));
  assert(restored.dataJson.find("42") != std::string::npos);
  assert(restored.events.empty());

  bool invalidPayloadRejected = false;
  try {
    document->apply("setCell", std::string_view("{} , \"injected\":true"));
  } catch (const std::runtime_error&) {
    invalidPayloadRejected = true;
  }
  assert(invalidPayloadRejected);
  assert(document->apply("getCell", std::string_view("{\"addr\":\"A1\"}"))
    .dataJson.find("42") != std::string::npos);

  const size_t before = document->documentSize();
  assert(before > 0);
  const std::string wide(64 * 1024, 'x');
  document->apply("setCell", std::string_view("{\"addr\":\"B2\",\"value\":\"" + wide + "\"}"));
  const size_t after = document->documentSize();
  assert(after >= before + wide.size());
  assert(document->documentSize() == after);

  document->close();
  document->close();
  assert(!document->isOpen());
  assert(document->documentSize() == 0);
  bool closedRejected = false;
  try {
    document->snapshot();
  } catch (const std::runtime_error&) {
    closedRejected = true;
  }
  assert(closedRejected);

  std::cout << "NitroForge v1 C++ RAII session smoke passed" << std::endl;
  return 0;
}
