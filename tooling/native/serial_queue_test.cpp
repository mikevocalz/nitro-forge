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

  // A scheduler failure must not wedge the queue or run the rejected task later.
  {
    std::vector<ForgeSerialQueue::Task> pending;
    bool failNext = true;
    auto flaky = ForgeSerialQueue::create([&](ForgeSerialQueue::Task task) {
      if (failNext) {
        failNext = false;
        throw std::runtime_error("scheduler unavailable");
      }
      pending.push_back(std::move(task));
    });
    std::vector<int> ran;
    bool submitThrew = false;
    try {
      flaky->submit([&]() { ran.push_back(1); });
    } catch (const std::runtime_error&) {
      submitThrew = true;
    }
    require(submitThrew, "scheduler failure reaches the caller");
    flaky->submit([&]() { ran.push_back(2); });
    require(pending.size() == 1, "the next submit schedules a fresh drain");
    while (!pending.empty()) {
      auto run = std::move(pending.back());
      pending.pop_back();
      run();
    }
    require(ran.size() == 1 && ran[0] == 2, "the withdrawn task never runs; the next one does");
  }

  // A throwing task must not strand the tasks queued behind it.
  {
    std::vector<ForgeSerialQueue::Task> pending;
    auto inline_queue = ForgeSerialQueue::create([&](ForgeSerialQueue::Task task) {
      pending.push_back(std::move(task));
    });
    std::vector<int> ran;
    inline_queue->submit([&]() { throw std::logic_error("task broke its contract"); });
    inline_queue->submit([&]() { ran.push_back(2); });
    inline_queue->submit([&]() { ran.push_back(3); });
    int escaped = 0;
    while (!pending.empty()) {
      auto run = std::move(pending.front());
      pending.erase(pending.begin());
      try {
        run();
      } catch (const std::logic_error&) {
        ++escaped;
      }
    }
    require(escaped == 1, "the task's exception still propagates");
    require(ran.size() == 2 && ran[0] == 2 && ran[1] == 3, "later tasks run in order after a throw");
    inline_queue->submit([&]() { ran.push_back(4); });
    require(pending.size() == 1, "the queue accepts and schedules new work afterwards");
    pending.front()();
    require(ran.back() == 4, "new work runs");
  }

  std::printf("serial queue: %d tasks in order, max concurrency %d\n", kTasks, maxRunning.load());
  return 0;
}
