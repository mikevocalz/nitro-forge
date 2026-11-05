#include "ForgeWindowsModule.hpp"
#include "ReactWorkerTask.hpp"
#include "RegisterForgeWindows.hpp"
#include "SnapshotCodec.hpp"

#include <cmath>
#include <limits>
#include <optional>
#include <stdexcept>
#include <string_view>
#include <utility>

namespace nitroforge::windows {
using winrt::Microsoft::ReactNative::ReactPromise;

void ForgeWindowsModule::openEngine(std::string kind, ReactPromise<std::string> promise) noexcept {
  submitReactTask(_worker, promise, [kind = std::move(kind)](DocumentSessions& documents) {
    return documents.open(kind);
  });
}

void ForgeWindowsModule::apply(ApplyRequest request, ReactPromise<CommandReply> promise) noexcept {
  submitReactTask(_worker, promise, [request = std::move(request)](DocumentSessions& documents) {
    if (!std::isfinite(request.version) || request.version < 1 ||
        request.version > static_cast<double>(std::numeric_limits<uint32_t>::max()) ||
        std::trunc(request.version) != request.version) {
      throw std::invalid_argument("Invalid Ignition command schema version");
    }
    std::optional<std::string_view> payload;
    if (!request.payloadJson.empty()) payload = request.payloadJson;
    auto result = documents.at(request.documentId).apply(
        request.operation, payload, static_cast<uint32_t>(request.version));
    CommandReply reply;
    reply.dataJson = std::move(result.dataJson);
    reply.events.reserve(result.events.size());
    for (auto& event : result.events) {
      CommandEvent item;
      item.kind = std::move(event.kind);
      if (event.detailJson) item.detailJson = std::move(*event.detailJson);
      reply.events.emplace_back(std::move(item));
    }
    return reply;
  });
}

void ForgeWindowsModule::snapshotB64(std::string documentId, ReactPromise<std::string> promise) noexcept {
  submitReactTask(_worker, promise, [documentId = std::move(documentId)](DocumentSessions& documents) {
    return encodeSnapshot(documents.at(documentId).snapshot());
  });
}

void ForgeWindowsModule::restoreB64(std::string documentId, std::string bytesB64,
                                  ReactPromise<void> promise) noexcept {
  submitReactTask(_worker, promise,
      [documentId = std::move(documentId), bytesB64 = std::move(bytesB64)](DocumentSessions& documents) {
        auto bytes = decodeSnapshot(bytesB64);
        documents.at(documentId).restore(bytes);
      });
}

void ForgeWindowsModule::undo(std::string documentId, ReactPromise<bool> promise) noexcept {
  submitReactTask(_worker, promise, [documentId = std::move(documentId)](DocumentSessions& documents) {
    const auto result = documents.at(documentId).apply("__undo");
    if (result.dataJson == R"({"undone":true})") return true;
    if (result.dataJson == R"({"undone":false})") return false;
    throw std::runtime_error("Invalid native undo response");
  });
}

void ForgeWindowsModule::redo(std::string documentId, ReactPromise<bool> promise) noexcept {
  submitReactTask(_worker, promise, [documentId = std::move(documentId)](DocumentSessions& documents) {
    const auto result = documents.at(documentId).apply("__redo");
    if (result.dataJson == R"({"redone":true})") return true;
    if (result.dataJson == R"({"redone":false})") return false;
    throw std::runtime_error("Invalid native redo response");
  });
}

void ForgeWindowsModule::closeEngine(std::string documentId, ReactPromise<bool> promise) noexcept {
  submitReactTask(_worker, promise, [documentId = std::move(documentId)](DocumentSessions& documents) {
    return documents.close(documentId);
  });
}

void RegisterForgeWindows(winrt::Microsoft::ReactNative::IReactPackageBuilder const& builder) noexcept {
  builder.AddTurboModule(L"ForgeWindows",
      winrt::Microsoft::ReactNative::MakeModuleProvider<ForgeWindowsModule>());
}

} // namespace nitroforge::windows
