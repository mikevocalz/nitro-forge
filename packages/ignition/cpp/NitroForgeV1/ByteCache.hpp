#pragma once
#include <list>
#include <optional>
#include <span>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>
#include <cstdint>
namespace nitroforge::native {
// Owner-queue only. No JS/native resource handles or document state live here.
class ByteCache final {
 public:
 explicit ByteCache(size_t capacity):_capacity(capacity){if(capacity==0||capacity>256u*1024u*1024u)throw std::invalid_argument("Cache capacity must be 1..256 MiB");}
 size_t size()const{return _bytes;}
 void put(const std::string& key,std::span<const uint8_t> bytes){
  if(key.empty()||key.size()>1024||bytes.size()>_capacity)throw std::invalid_argument("Cache key or value exceeds bounds");
  std::vector<uint8_t> copy(bytes.begin(),bytes.end());
  remove(key);
  while(!_order.empty()&&(_bytes+copy.size()>_capacity||_entries.size()>=4096))remove(_order.back());
  _order.push_front(key);_bytes+=copy.size();_entries.emplace(key,Entry{std::move(copy),_order.begin()});
 }
 std::optional<std::vector<uint8_t>> get(const std::string& key){
  auto found=_entries.find(key);if(found==_entries.end())return std::nullopt;
  _order.splice(_order.begin(),_order,found->second.order);return found->second.bytes;
 }
 bool remove(const std::string& key){auto it=_entries.find(key);if(it==_entries.end())return false;_bytes-=it->second.bytes.size();_order.erase(it->second.order);_entries.erase(it);return true;}
 void clear(){_entries.clear();_order.clear();_bytes=0;}
 private:
 struct Entry{std::vector<uint8_t> bytes;std::list<std::string>::iterator order;};
 size_t _capacity,_bytes=0;std::list<std::string> _order;std::unordered_map<std::string,Entry> _entries;
};
}
