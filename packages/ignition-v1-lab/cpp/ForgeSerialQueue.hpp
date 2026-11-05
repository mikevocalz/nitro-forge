#pragma once

#include <cstdint>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <utility>

namespace nitroforge::native {

/**
 * Runs one document's commands one at a time, in submission order.
 *
 * Nitro's shared ThreadPool has several workers, so independent
 * `Promise::async` calls can start in any order: `apply(A); apply(B)` without
 * awaiting could reach the engine as B then A, and an `undo()` could overtake
 * the edit it was meant to revert. Each document owns one queue instead.
 *
 * Tasks run on the scheduler supplied at construction (Nitro's ThreadPool in
 * production). At most one drain is scheduled at a time and no worker blocks
 * waiting for its turn. Tasks must not throw; callers resolve or reject their
 * Promise inside the task. The lock is never held while a task runs.
 *
 * Failure paths keep the queue usable instead of leaving `_draining` stuck,
 * which would strand every later Promise on the document:
 * - If the scheduler throws, submit() removes the task it just added and
 *   rethrows, so a call that failed synchronously never runs later.
 * - If a task throws anyway, the remaining tasks move to a fresh drain before
 *   the exception propagates on the worker thread.
 */
class ForgeSerialQueue final : public std::enable_shared_from_this<ForgeSerialQueue> {
 public:
  using Task = std::function<void()>;
  using Scheduler = std::function<void(Task)>;

  static std::shared_ptr<ForgeSerialQueue> create(Scheduler scheduler);

  ForgeSerialQueue(const ForgeSerialQueue&) = delete;
  ForgeSerialQueue& operator=(const ForgeSerialQueue&) = delete;

  void submit(Task task);

 private:
  explicit ForgeSerialQueue(Scheduler scheduler);
  void drain();
  void scheduleDrain();

  const Scheduler _scheduler;
  std::mutex _mutex;
  std::deque<std::pair<uint64_t, Task>> _tasks;
  uint64_t _nextId = 0;
  bool _draining = false;
};

} // namespace nitroforge::native
