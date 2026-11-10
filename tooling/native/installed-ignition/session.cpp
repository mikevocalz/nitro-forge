#include <NitroForgeV1/ForgeRustSession.hpp>
#include <NitroForgeV1/SerialQueue.hpp>
#include <NitroForgeV1/TaskControl.hpp>

#include <array>
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
void require(bool condition, const char* message) {
  if (!condition) throw std::runtime_error(message);
}
} // namespace

int main() {
  using nitroforge::native::ForgeRustSession;
  constexpr std::array kinds{"prism", "cadence", "splice", "folio", "pitch",
                             "tally", "quill", "photo", "motion", "design", "draft"};
  for (const auto* kind : kinds) {
    auto document = ForgeRustSession::open(kind);
    document->apply("new", std::string_view(kind) == "prism" ? R"({"width":4,"height":4})" : "{}");
    const auto description = document->apply("describe", "{}").dataJson;
    const auto snapshot = document->snapshot();
    require(snapshot.size() >= 9 && std::memcmp(snapshot.data(), "NFD1", 4) == 0,
            "engine did not return an NFD1 snapshot");
    auto reopened = ForgeRustSession::open(kind);
    reopened->restore(snapshot);
    // Draft deliberately advances source_revision on restore; its persisted
    // snapshot excludes that session-local revision and compares exactly.
    const bool preserved = std::string_view(kind) == "draft"
        ? reopened->snapshot() == snapshot
        : reopened->apply("describe", "{}").dataJson == description;
    if (!preserved)
      throw std::runtime_error(std::string(kind) + " lost document state on reopen");
    document->close();
    reopened->close();
  }

  auto document = ForgeRustSession::open("tally");
  document->apply("new", "{}");
  document->apply("setCell", R"({"addr":"A1","value":"42"})");
  const auto snapshot = document->snapshot();
  document->apply("setCell", R"({"addr":"A1","value":"8"})");
  require(document->apply("__undo").dataJson == R"({"undone":true})", "undo failed");
  require(document->apply("getCell", R"({"addr":"A1"})").dataJson.find("42") != std::string::npos,
          "undo did not restore the cell");
  require(document->apply("__redo").dataJson == R"({"redone":true})", "redo failed");
  document->restore(snapshot);
  require(document->apply("getCell", R"({"addr":"A1"})").dataJson.find("42") != std::string::npos,
          "restore did not recover the saved cell");
  auto binary = document->applyBinary("__snapshot", "{}", 1, std::nullopt);
  require(binary.output && *binary.output == snapshot, "binary result lost snapshot bytes");
  nitroforge::native::TaskControl control;
  control.cancel();
  bool cancelled = false;
  try {
    document->applyBinary("setCell", R"({"addr":"A1","value":"0"})", 1,
                          std::nullopt, control.native());
  } catch (const std::runtime_error& error) {
    cancelled = std::string(error.what()).find("cancelled") != std::string::npos;
  }
  require(cancelled && document->snapshot() == snapshot, "cancelled work changed the document");

  std::vector<nitroforge::native::SerialQueue::Job> scheduled;
  std::vector<int> order;
  {
    nitroforge::native::SerialQueue queue([&](auto work) { scheduled.push_back(std::move(work)); });
    queue.enqueue([&] { order.push_back(1); });
    queue.enqueue([&] { order.push_back(2); });
    queue.enqueue([&] { document->close(); order.push_back(3); });
    require(scheduled.size() == 1, "document queue admitted parallel workers");
  }
  scheduled.front()();
  require(order == std::vector<int>({1, 2, 3}) && !document->isOpen(),
          "accepted work did not drain in FIFO order after queue release");
  document->close();
  bool closed = false;
  try { document->snapshot(); } catch (const std::runtime_error&) { closed = true; }
  require(closed, "closed document accepted work");
  std::cout << "INSTALLED_IGNITION_OK engines=11 reopen=11 edit=1 undo=1 redo=1 binary=1 cancel=1 fifo=1 close=1\n";
}
