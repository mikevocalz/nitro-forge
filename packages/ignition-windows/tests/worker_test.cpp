#include "ForgeWorker.hpp"

#include <future>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <thread>
#include <type_traits>
#include <utility>
#include <vector>

using nitroforge::windows::DocumentSessions;
using nitroforge::windows::ForgeWorker;

namespace {

void require(bool condition, const char* message) {
  if (!condition) throw std::runtime_error(message);
}

template <typename Work>
auto submit(ForgeWorker& worker, Work work) {
  using Result = std::invoke_result_t<Work, DocumentSessions&>;
  auto promise = std::make_shared<std::promise<Result>>();
  auto future = promise->get_future();
  worker.submit([promise, work = std::move(work)](DocumentSessions& documents) noexcept {
    try {
      if constexpr (std::is_void_v<Result>) {
        work(documents);
        promise->set_value();
      } else {
        promise->set_value(work(documents));
      }
    } catch (...) {
      promise->set_exception(std::current_exception());
    }
  });
  return future;
}

void testRealEngine() {
  ForgeWorker worker;
  const auto caller = std::this_thread::get_id();
  const auto token = submit(worker, [caller](DocumentSessions& documents) {
    require(std::this_thread::get_id() != caller, "engine must run off the calling thread");
    return documents.open("tally");
  }).get();
  // Deliberately enqueue dependent operations without awaiting their completion.
  auto first = submit(worker, [token](DocumentSessions& documents) {
    documents.at(token).apply("setCell", R"({"addr":"A1","value":"10"})");
  });
  auto second = submit(worker, [token](DocumentSessions& documents) {
    documents.at(token).apply("setCell", R"({"addr":"B1","value":"=A1*2"})");
    documents.at(token).apply("setCell", R"({"addr":"A1","value":"21"})");
  });
  auto undo = submit(worker, [token](DocumentSessions& documents) {
    require(documents.at(token).apply("__undo").dataJson == R"({"undone":true})", "undo failed");
    require(documents.at(token).apply("evaluate", R"({"formula":"=B1"})").dataJson == R"({"value":20.0})",
            "FIFO edit/undo ordering failed");
    return documents.at(token).snapshot();
  });
  first.get();
  second.get();
  const auto snapshot = undo.get();

  auto rejected = submit(worker, [token](DocumentSessions& documents) {
    documents.at(token).apply("setCell", R"({"addr":"A0","value":"99"})");
  });
  bool failed = false;
  try { rejected.get(); } catch (const std::exception&) { failed = true; }
  require(failed, "invalid engine command must reject");
  submit(worker, [token, snapshot](DocumentSessions& documents) {
    require(documents.at(token).snapshot() == snapshot, "failed edit mutated the document");
    require(documents.close(token), "first close must report a live session");
    require(!documents.close(token), "close must be idempotent");
    const auto reopened = documents.open("tally");
    require(reopened != token, "native tokens must not be reused");
    documents.at(reopened).restore(snapshot);
    require(documents.at(reopened).apply("evaluate", R"({"formula":"=B1"})").dataJson == R"({"value":20.0})",
            "restored engine must recompute the saved formula");
    require(documents.at(reopened).apply("__undo").dataJson == R"({"undone":false})", "restore must reset history");
    // Deliberately leave the reopened document to worker teardown.
  }).get();
}

void testTeardownDrains() {
  std::vector<std::future<size_t>> pending;
  {
    ForgeWorker worker;
    for (size_t index = 0; index < 128; ++index) {
      pending.emplace_back(submit(worker, [index](DocumentSessions&) { return index; }));
    }
  }
  for (size_t index = 0; index < pending.size(); ++index) {
    require(pending[index].get() == index, "teardown must settle all accepted work");
  }
}

} // namespace

int main() {
  try {
    testRealEngine();
    testTeardownDrains();
    std::cout << "PASS Windows adapter worker: real Rust Tally edit/undo/restore, rejection, FIFO, teardown\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "FAIL Windows adapter worker: " << error.what() << '\n';
    return 1;
  }
}
