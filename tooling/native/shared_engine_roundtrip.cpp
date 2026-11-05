// A real native consumer of the same C++ wrapper and Rust engine used by Nitro.
// Two invocations prove persistence across process lifetime, not just a restore
// into the document that produced the snapshot. Checks stay active in Release.
#include "ForgeRustSession.hpp"

#include <algorithm>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

using nitroforge::native::CommandResult;
using nitroforge::native::ForgeRustSession;

namespace {

void require(bool condition, std::string_view message) {
  if (!condition) {
    throw std::runtime_error(std::string(message));
  }
}

template <typename Function>
void requireFailure(Function function, std::string_view message) {
  bool rejected = false;
  try {
    function();
  } catch (const std::exception&) {
    rejected = true;
  }
  require(rejected, message);
}

void requireChanged(const CommandResult& result) {
  require(std::any_of(result.events.begin(), result.events.end(), [](const auto& event) {
    return event.kind == "document:changed";
  }), "a cell edit must emit document:changed");
}

void requireValue(const ForgeRustSession& document, std::string_view expected) {
  const auto result = document.apply("evaluate", R"({"formula":"=B1"})");
  // evaluate returns one scalar field, so the comparison is independent of
  // object-key order and cannot accidentally match a different cell or value.
  require(result.dataJson == expected,
          "unexpected formula result: " + result.dataJson + "; expected " + std::string(expected));
  require(result.events.empty(), "reading a formula must not emit mutations");
}

void requireAtomicFailures(const ForgeRustSession& document) {
  const auto before = document.snapshot();
  requireFailure([&]() {
    document.apply("setCell", R"({"addr":"A1","value":"999"},"injected":true)");
  }, "malformed payload must reject");
  requireFailure([&]() {
    document.apply("setCell", R"({"addr":"A0","value":"999"})");
  }, "invalid cell address must reject");
  auto corrupt = before;
  require(!corrupt.empty(), "snapshot must be nonempty");
  corrupt.front() = static_cast<uint8_t>('X');
  requireFailure([&]() { document.restore(corrupt); }, "corrupt NFD1 must reject");
  require(document.snapshot() == before, "failed commands and restore must leave the document intact");
}

void writeDocument(const std::filesystem::path& path) {
  auto document = ForgeRustSession::open("tally");
  require(document->isOpen(), "open must return a ready session");
  document->apply("new", "{}");
  requireChanged(document->apply("setCell", R"({"addr":"A1","value":"10"})"));
  requireChanged(document->apply("setCell", R"({"addr":"A2","value":"20"})"));
  requireChanged(document->apply("setCell", R"json({"addr":"B1","value":"=SUM(A1:A2)"})json"));
  requireValue(*document, R"({"value":30.0})");

  document->apply("setCell", R"({"addr":"A1","value":"22"})");
  requireValue(*document, R"({"value":42.0})");
  require(document->apply("__undo").dataJson == R"({"undone":true})", "undo must report a change");
  requireValue(*document, R"({"value":30.0})");
  require(document->apply("__redo").dataJson == R"({"redone":true})", "redo must report a change");
  requireValue(*document, R"({"value":42.0})");

  auto independent = ForgeRustSession::open("tally");
  independent->apply("setCell", R"({"addr":"B1","value":"99"})");
  requireValue(*independent, R"({"value":99.0})");
  requireValue(*document, R"({"value":42.0})");
  independent->close();

  requireAtomicFailures(*document);
  require(document->documentSize() > 0, "live Rust state must report owned memory");
  const auto bytes = document->snapshot();
  require(bytes.size() >= 9 && std::equal(bytes.begin(), bytes.begin() + 4, "NFD1"),
          "snapshot must use the existing NFD1 format");
  {
    // Filesystem work belongs to the host; the Rust engine only returns bytes.
    std::ofstream file(path, std::ios::binary | std::ios::trunc);
    file.exceptions(std::ios::badbit | std::ios::failbit);
    file.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
    file.close();
  }
  document->close();
  document->close();
  require(!document->isOpen() && document->documentSize() == 0, "close must be idempotent");
  requireFailure([&]() { document->snapshot(); }, "closed session must reject calls");
  std::cout << "PASS Tally: formula, edit, undo/redo, isolation, atomic rejection, save, close ("
            << bytes.size() << " NFD1 bytes)\n";
}

void readDocument(const std::filesystem::path& path) {
  const auto size = std::filesystem::file_size(path);
  require(size > 0 && size <= 256u * 1024u * 1024u, "snapshot file exceeds the native ABI bounds");
  std::ifstream file(path, std::ios::binary);
  file.exceptions(std::ios::badbit);
  require(file.is_open(), "cannot open saved document");
  const std::vector<uint8_t> bytes{std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
  require(bytes.size() == size, "saved document was not read completely");

  auto reopened = ForgeRustSession::open("tally");
  reopened->restore(bytes);
  require(reopened->snapshot() == bytes, "reopen must preserve the saved document exactly");
  requireValue(*reopened, R"({"value":42.0})");
  require(reopened->apply("__undo").dataJson == R"({"undone":false})",
          "restore must start a fresh undo journal");
  reopened->apply("setCell", R"({"addr":"A2","value":"21"})");
  requireValue(*reopened, R"({"value":43.0})");
  reopened->apply("__undo");
  requireValue(*reopened, R"({"value":42.0})");
  requireAtomicFailures(*reopened);
  reopened->close();
  requireFailure([]() { ForgeRustSession::open("missing-engine"); }, "unknown engine must reject");
  std::cout << "PASS Tally: reopen in a new process, recompute, edit, undo, reject corrupt input, close\n";
}

} // namespace

int main(int argc, char** argv) {
  try {
    if (argc != 3) {
      throw std::invalid_argument("usage: forge_shared_engine_roundtrip write|read <snapshot.nfd>");
    }
    const std::string_view mode(argv[1]);
    if (mode == "write") {
      writeDocument(argv[2]);
    } else if (mode == "read") {
      readDocument(argv[2]);
    } else {
      throw std::invalid_argument("mode must be write or read");
    }
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "FAIL shared native engine: " << error.what() << '\n';
    return 1;
  }
}
