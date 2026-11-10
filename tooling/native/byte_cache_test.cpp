#include <NitroForgeV1/ByteCache.hpp>

#include <cassert>
#include <cstdlib>
#include <new>
#include <string>
#include <vector>

// Fault injection stays in this executable. Every production allocation path
// is exercised without an allocator hook in the cache's public contract.
static thread_local std::ptrdiff_t allocationsBeforeFailure = -1;
void* operator new(std::size_t size) {
  if (allocationsBeforeFailure >= 0 && allocationsBeforeFailure-- == 0) throw std::bad_alloc();
  if (auto* pointer = std::malloc(size == 0 ? 1 : size)) return pointer;
  throw std::bad_alloc();
}
void operator delete(void* pointer) noexcept { std::free(pointer); }
void operator delete(void* pointer, std::size_t) noexcept { std::free(pointer); }
void* operator new[](std::size_t size) { return ::operator new(size); }
void operator delete[](void* pointer) noexcept { ::operator delete(pointer); }
void operator delete[](void* pointer, std::size_t) noexcept { ::operator delete(pointer); }

using nitroforge::native::ByteCache;

static void failedPutKeepsPriorEntries(bool replacement) {
  bool completed = false;
  int failures = 0;
  for (int point = 0; point < 16; point++) {
    ByteCache cache(4);
    const std::vector<uint8_t> first{1, 2}, second{3, 4}, next{5, 6, 7};
    cache.put("a", first); cache.put("b", second);
    allocationsBeforeFailure = point;
    try {
      cache.put(replacement ? "a" : "c", next);
      allocationsBeforeFailure = -1;
      assert(cache.size() == 3 && !cache.get("b"));
      assert(cache.get(replacement ? "a" : "c") == next);
      completed = true;
      break;
    } catch (const std::bad_alloc&) {
      allocationsBeforeFailure = -1;
      failures++;
      assert(cache.size() == 4);
      assert(cache.get("a") == first && cache.get("b") == second);
      assert(!cache.get("c"));
    }
  }
  assert(completed && failures > 0);
}

int main() {
  failedPutKeepsPriorEntries(false);
  failedPutKeepsPriorEntries(true);

  ByteCache cache(4);
  cache.put("a", std::vector<uint8_t>{1, 2});
  cache.put("b", std::vector<uint8_t>{3, 4});
  allocationsBeforeFailure = 0;
  try { (void)cache.get("a"); assert(false); }
  catch (const std::bad_alloc&) { allocationsBeforeFailure = -1; }
  cache.put("c", std::vector<uint8_t>{5, 6});
  assert(!cache.get("a") && cache.get("b") && cache.get("c"));
  assert(cache.size() == 4);

  ByteCache emptyValues(1);
  for (int index = 0; index < 4097; index++) emptyValues.put(std::to_string(index), {});
  assert(!emptyValues.get("0") && emptyValues.get("1") && emptyValues.get("4096"));
  assert(emptyValues.size() == 0);
  assert(emptyValues.remove("1") && !emptyValues.remove("1"));
  emptyValues.clear();
  assert(!emptyValues.get("4096"));

  bool rejected = false;
  try { cache.put(std::string(1025, 'x'), {}); } catch (const std::invalid_argument&) { rejected = true; }
  assert(rejected && cache.size() == 4);
}
