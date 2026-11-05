#pragma once

#include "DocumentSessions.hpp"

#include <condition_variable>
#include <deque>
#include <functional>
#include <mutex>
#include <thread>

namespace nitroforge::windows {

// One owned FIFO for this RNW module. Sessions never leave the worker thread.
// submit() either accepts a task or throws before insertion. Accepted tasks must
// not throw; the RNW boundary catches engine failures and settles each promise.
class ForgeWorker final {
 public:
  using Task = std::function<void(DocumentSessions&)>;

  ForgeWorker();
  ~ForgeWorker() noexcept;
  ForgeWorker(const ForgeWorker&) = delete;
  ForgeWorker& operator=(const ForgeWorker&) = delete;

  void submit(Task task);

 private:
  void run() noexcept;

  // The mutex protects only admission and the pending task deque. It is never
  // held while executing engine code or resolving a React promise.
  std::mutex _mutex;
  std::condition_variable _ready;
  std::deque<Task> _tasks;
  bool _stopping{false};
  std::thread _thread;
};

} // namespace nitroforge::windows
