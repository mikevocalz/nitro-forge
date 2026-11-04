#pragma once
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <utility>

namespace nitroforge::native {
/** One drain job per document; no pool thread blocks waiting for another job.
 * The state outlives the HybridObject while any accepted work remains queued.
 */
class SerialQueue final {
 public:
  using Job = std::function<void()>;
  using Schedule = std::function<void(Job)>;
  explicit SerialQueue(Schedule schedule)
      : _state(std::make_shared<State>()), _schedule(std::move(schedule)) {}

  void enqueue(Job job) {
    const auto state = _state;
    std::lock_guard lock(state->mutex);
    state->jobs.push_back(std::move(job));
    if (state->running) return;
    state->running = true;
    try {
      // The scheduler must enqueue asynchronously, never invoke inline.
      _schedule([state]() {
        for (;;) {
          Job next;
          {
            std::lock_guard guard(state->mutex);
            if (state->jobs.empty()) { state->running = false; return; }
            next = std::move(state->jobs.front()); state->jobs.pop_front();
          }
          // Each submitted job owns its Promise rejection boundary.
          next();
        }
      });
    } catch (...) {
      state->running = false;
      state->jobs.pop_back();
      throw;
    }
  }
 private:
  struct State { std::mutex mutex; std::deque<Job> jobs; bool running = false; };
  std::shared_ptr<State> _state;
  Schedule _schedule;
};
} // namespace nitroforge::native
