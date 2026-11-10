#pragma once
#include <cstdint>
#include <list>
#include <optional>
#include <span>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace nitroforge::native {
// Owner-queue only. No JS/native resource handles or document state live here.
class ByteCache final {
 public:
  explicit ByteCache(size_t capacity) : _capacity(capacity) {
    if (capacity == 0 || capacity > 256u * 1024u * 1024u)
      throw std::invalid_argument("Cache capacity must be 1..256 MiB");
  }
  size_t size() const { return _bytes; }

  void put(const std::string& key, std::span<const uint8_t> bytes) {
    if (key.empty() || key.size() > 1024 || bytes.size() > _capacity)
      throw std::invalid_argument("Cache key or value exceeds bounds");
    std::vector<uint8_t> copy(bytes.begin(), bytes.end());
    const auto found = _entries.find(key);
    if (found != _entries.end()) {
      // Vector move and list splice cannot allocate. Keep the previous entry
      // until the replacement allocation has succeeded.
      _bytes -= found->second.bytes.size();
      found->second.bytes = std::move(copy);
      _order.splice(_order.begin(), _order, found->second.order);
    } else {
      _order.push_front(key);
      try { _entries.emplace(key, Entry{std::move(copy), _order.begin()}); }
      catch (...) { _order.pop_front(); throw; }
    }
    _bytes += bytes.size();
    // Allocate before evicting: rejection must preserve entries, LRU order,
    // and byte accounting so a later put or get remains usable.
    while (_bytes > _capacity || _entries.size() > 4096) remove(_order.back());
  }

  std::optional<std::vector<uint8_t>> get(const std::string& key) {
    const auto found = _entries.find(key);
    if (found == _entries.end()) return std::nullopt;
    auto copy = found->second.bytes;
    _order.splice(_order.begin(), _order, found->second.order);
    return copy;
  }

  bool remove(const std::string& key) {
    const auto found = _entries.find(key);
    if (found == _entries.end()) return false;
    _bytes -= found->second.bytes.size();
    _order.erase(found->second.order);
    _entries.erase(found);
    return true;
  }
  void clear() { _entries.clear(); _order.clear(); _bytes = 0; }

 private:
  struct Entry { std::vector<uint8_t> bytes; std::list<std::string>::iterator order; };
  size_t _capacity, _bytes = 0;
  std::list<std::string> _order;
  std::unordered_map<std::string, Entry> _entries;
};
}
