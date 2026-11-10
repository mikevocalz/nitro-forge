#include <NitroForgeV1/SerialQueue.hpp>
#include <cassert>
#include <vector>
#include <stdexcept>
using nitroforge::native::SerialQueue;
int main() {
  std::vector<SerialQueue::Job> scheduled;
  std::vector<int> order;
  {
    SerialQueue queue([&](auto job) { scheduled.push_back(std::move(job)); });
    queue.enqueue([&] { order.push_back(1); });
    queue.enqueue([&] { order.push_back(2); });
    queue.enqueue([&] { order.push_back(3); }); // snapshot/close cannot overtake edits
    assert(scheduled.size() == 1);
  } // destruction before draining must preserve all accepted jobs
  scheduled.front()();
  assert((order == std::vector<int>{1, 2, 3}));
  scheduled.clear();
  SerialQueue queue([&](auto job) { scheduled.push_back(std::move(job)); });
  queue.enqueue([&] { order.push_back(4); }); scheduled.back()();
  queue.enqueue([&] { order.push_back(5); }); assert(scheduled.size() == 2); scheduled.back()();
  assert(order.back() == 5);
  int attempts = 0;
  SerialQueue retry([&](auto job) { if (attempts++ == 0) throw std::runtime_error("scheduler"); scheduled.push_back(std::move(job)); });
  try { retry.enqueue([&] { order.push_back(-1); }); assert(false); } catch (const std::runtime_error&) {}
  retry.enqueue([&] { order.push_back(6); }); scheduled.back()(); assert(order.back() == 6);
}
