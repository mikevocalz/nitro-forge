#include "ForgeSerialQueue.hpp"

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
  {
    std::lock_guard<std::mutex> lock(_mutex);
    _tasks.push_back(std::move(task));
    if (!_draining) {
      _draining = true;
      startDrain = true;
    }
  }
  if (startDrain) {
    // The drain keeps the queue alive until it has emptied it.
    _scheduler([self = shared_from_this()]() { self->drain(); });
  }
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
      task = std::move(_tasks.front());
      _tasks.pop_front();
    }
    task();
  }
}

} // namespace nitroforge::native
