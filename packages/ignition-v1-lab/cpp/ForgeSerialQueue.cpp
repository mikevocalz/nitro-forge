#include "ForgeSerialQueue.hpp"

#include <algorithm>
#include <stdexcept>
#include <utility>

namespace nitroforge::native {

std::shared_ptr<ForgeSerialQueue> ForgeSerialQueue::create(Scheduler scheduler) {
  if (!scheduler) {
    throw std::invalid_argument("ForgeSerialQueue requires a scheduler");
  }
  return std::shared_ptr<ForgeSerialQueue>(new ForgeSerialQueue(std::move(scheduler)));
}

ForgeSerialQueue::ForgeSerialQueue(Scheduler scheduler) : _scheduler(std::move(scheduler)) {}

void ForgeSerialQueue::submit(Task task) {
  bool startDrain = false;
  uint64_t id = 0;
  {
    std::lock_guard<std::mutex> lock(_mutex);
    id = ++_nextId;
    _tasks.emplace_back(id, std::move(task));
    if (!_draining) {
      _draining = true;
      startDrain = true;
    }
  }
  if (!startDrain) {
    return;
  }
  try {
    scheduleDrain();
  } catch (...) {
    // No drain is running. Withdraw this caller's task (it is reporting the
    // failure synchronously) and release the drain flag, so the next submit
    // schedules a drain for anything another thread queued meanwhile.
    std::lock_guard<std::mutex> lock(_mutex);
    _tasks.erase(
        std::remove_if(_tasks.begin(), _tasks.end(),
                       [id](const auto& entry) { return entry.first == id; }),
        _tasks.end());
    _draining = false;
    throw;
  }
}

void ForgeSerialQueue::scheduleDrain() {
  // The drain keeps the queue alive until it has emptied it.
  _scheduler([self = shared_from_this()]() { self->drain(); });
}

void ForgeSerialQueue::drain() {
  for (;;) {
    Task task;
    {
      std::lock_guard<std::mutex> lock(_mutex);
      if (_tasks.empty()) {
        _draining = false;
        return;
      }
      task = std::move(_tasks.front().second);
      _tasks.pop_front();
    }
    try {
      task();
    } catch (...) {
      // Tasks must not throw. If one does, hand the rest of the queue to a new
      // drain (still one at a time) before the exception leaves this worker.
      bool more = false;
      {
        std::lock_guard<std::mutex> lock(_mutex);
        more = !_tasks.empty();
        if (!more) {
          _draining = false;
        }
      }
      if (more) {
        scheduleDrain();
      }
      throw;
    }
  }
}

} // namespace nitroforge::native
