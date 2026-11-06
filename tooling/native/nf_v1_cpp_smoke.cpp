#include <NitroForgeV1/ForgeRustSession.hpp>
#include <NitroForgeV1/TaskControl.hpp>
#include <NitroForgeV1/ByteCache.hpp>

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

  auto raw = document->applyBinary("__snapshot", "{}", 1, std::nullopt);
  assert(raw.output && *raw.output == source);
  auto control = std::make_shared<nitroforge::native::TaskControl>();
  auto workerControl = control;
  control->cancel();
  control.reset(); // accepted work keeps cancellation alive after JS releases its task
  bool cancelled = false;
  try { document->applyBinary("setCell", "{\"addr\":\"A1\",\"value\":\"0\"}", 1, std::nullopt, workerControl->native()); }
  catch (const std::runtime_error& error) { cancelled = std::string(error.what()).find("cancelled") != std::string::npos; }
  assert(cancelled && document->snapshot() == source);
  workerControl.reset();
  nitroforge::native::ByteCache cache(4);
  std::vector<uint8_t> bytes{1, 2};
  cache.put("a", bytes); bytes[0] = 9;
  cache.put("b", std::vector<uint8_t>{3, 4});
  auto cached = cache.get("a"); assert(cached && (*cached)[0] == 1);
  (*cached)[0] = 8; assert((*cache.get("a"))[0] == 1);
  cache.put("c", std::vector<uint8_t>{5, 6});
  assert(!cache.get("b") && cache.get("a") && cache.size() == 4);
  bool bounded = false;
  try { cache.put("a", std::vector<uint8_t>(5)); } catch (const std::invalid_argument&) { bounded = true; }
  assert(bounded && (*cache.get("a"))[0] == 1);
  cache.clear(); assert(cache.size() == 0 && !cache.get("a"));

  document->close();
  document->close();
  assert(!document->isOpen());
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
