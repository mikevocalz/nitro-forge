#pragma once

#include <deque>
#include <functional>
#include <memory>
#include <mutex>

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

  const Scheduler _scheduler;
  std::mutex _mutex;
  std::deque<Task> _tasks;
  bool _draining = false;
};

} // namespace nitroforge::native
