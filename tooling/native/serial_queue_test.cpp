// Ordering contract for ForgeSerialQueue, built with plain threads so it runs
// without Nitro. Every drain gets a fresh thread, which is the worst case for
// reordering: if the queue let two drains run, tasks would interleave here.
#include "ForgeSerialQueue.hpp"

#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <mutex>
#include <stdexcept>
#include <thread>
#include <vector>

using nitroforge::native::ForgeSerialQueue;

namespace {

void require(bool ok, const char* what) {
  if (!ok) {
    std::fprintf(stderr, "FAIL: %s\n", what);
    std::exit(1);
  }
}

} // namespace

int main() {
  std::mutex threadsMutex;
  std::vector<std::thread> threads;
  auto queue = ForgeSerialQueue::create([&](ForgeSerialQueue::Task task) {
    std::lock_guard<std::mutex> lock(threadsMutex);
    threads.emplace_back(std::move(task));
  });

  constexpr int kTasks = 500;
  std::mutex orderMutex;
  std::vector<int> order;
  std::atomic<int> running{0};
  std::atomic<int> maxRunning{0};
  std::atomic<int> done{0};

  for (int i = 0; i < kTasks; ++i) {
    queue->submit([&, i]() {
      const int now = running.fetch_add(1) + 1;
      int seen = maxRunning.load();
      while (now > seen && !maxRunning.compare_exchange_weak(seen, now)) {}
      // Hold each task long enough that a second drain, if one were allowed,
      // would pop the next task and overlap with this one.
      std::this_thread::sleep_for(std::chrono::microseconds(20));
      {
        std::lock_guard<std::mutex> lock(orderMutex);
        order.push_back(i);
      }
      running.fetch_sub(1);
      done.fetch_add(1);
    });
    if (i % 50 == 0) std::this_thread::yield();
  }

  while (done.load() < kTasks) std::this_thread::yield();
  for (;;) {
    std::vector<std::thread> joinable;
    {
      std::lock_guard<std::mutex> lock(threadsMutex);
      joinable.swap(threads);
    }
    if (joinable.empty()) break;
    for (auto& t : joinable) t.join();
  }

  require(static_cast<int>(order.size()) == kTasks, "every task ran exactly once");
  for (int i = 0; i < kTasks; ++i) require(order[i] == i, "tasks ran in submission order");
  require(maxRunning.load() == 1, "no two tasks ran at the same time");

  bool threw = false;
  try {
    ForgeSerialQueue::create(nullptr);
  } catch (const std::invalid_argument&) {
    threw = true;
  }
  require(threw, "a null scheduler is rejected");

  std::printf("serial queue: %d tasks in order, max concurrency %d\n", kTasks, maxRunning.load());
  return 0;
}
