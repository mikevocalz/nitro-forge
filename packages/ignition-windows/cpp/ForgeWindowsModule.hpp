#pragma once

#include "ForgeWindowsTypes.hpp"
#include "ForgeWorker.hpp"

namespace nitroforge::windows {

REACT_MODULE_NOREG(ForgeWindowsModule, L"ForgeWindows")
struct ForgeWindowsModule final {
  REACT_METHOD(openEngine)
  void openEngine(std::string kind, winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept;

  REACT_METHOD(apply)
  void apply(ApplyRequest request, winrt::Microsoft::ReactNative::ReactPromise<CommandReply> promise) noexcept;

  REACT_METHOD(snapshotB64)
  void snapshotB64(std::string documentId, winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept;

  REACT_METHOD(restoreB64)
  void restoreB64(std::string documentId, std::string bytesB64,
                  winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept;

  REACT_METHOD(undo)
  void undo(std::string documentId, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept;

  REACT_METHOD(redo)
  void redo(std::string documentId, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept;

  REACT_METHOD(closeEngine)
  void closeEngine(std::string documentId, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept;

 private:
  ForgeWorker _worker;
};

} // namespace nitroforge::windows
