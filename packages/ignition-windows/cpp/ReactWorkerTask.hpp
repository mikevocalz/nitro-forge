#pragma once

#include "ForgeWorker.hpp"
#include <ReactPromise.h>

#include <exception>
#include <type_traits>
#include <utility>

namespace nitroforge::windows {

// The only RNW async boundary. Inputs are owned before leaving the native call.
// ReactPromise owns its writer and the RNW result callback schedules JS work.
// Never capture a raw module/worker pointer in the submitted task.
template <typename Result, typename Work>
void submitReactTask(ForgeWorker& worker,
                     winrt::Microsoft::ReactNative::ReactPromise<Result> promise,
                     Work work) noexcept {
  try {
    worker.submit([promise, work = std::move(work)](DocumentSessions& documents) noexcept {
      try {
        if constexpr (std::is_void_v<Result>) {
          work(documents);
          promise.Resolve();
        } else {
          promise.Resolve(work(documents));
        }
      } catch (const std::exception& error) {
        promise.Reject(error.what());
      } catch (...) {
        promise.Reject("Unknown native engine failure");
      }
    });
  } catch (const std::exception& error) {
    promise.Reject(error.what());
  } catch (...) {
    promise.Reject("Cannot submit native engine work");
  }
}

} // namespace nitroforge::windows
