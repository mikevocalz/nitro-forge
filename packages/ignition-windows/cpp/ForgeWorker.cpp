#include "ForgeWorker.hpp"

#include <stdexcept>
#include <utility>

namespace nitroforge::windows {

ForgeWorker::ForgeWorker() : _thread([this]() noexcept { run(); }) {}

ForgeWorker::~ForgeWorker() noexcept {
  {
    std::lock_guard lock(_mutex);
    _stopping = true;
  }
  _ready.notify_one();
  // Tasks never own this worker or module. Its RNW owner tears it down after
  // admission stops, from a different thread, and waits for accepted work.
  _thread.join();
}

void ForgeWorker::submit(Task task) {
  {
    std::lock_guard lock(_mutex);
    if (_stopping) throw std::runtime_error("Windows engine worker is stopping");
    _tasks.emplace_back(std::move(task));
  }
  _ready.notify_one();
}

void ForgeWorker::run() noexcept {
  DocumentSessions documents;
  for (;;) {
    Task task;
    {
      std::unique_lock lock(_mutex);
      _ready.wait(lock, [this]() { return _stopping || !_tasks.empty(); });
      if (_tasks.empty()) return; // documents close here, on their owner thread.
      task = std::move(_tasks.front());
      _tasks.pop_front();
    }
    task(documents);
  }
}

} // namespace nitroforge::windows
