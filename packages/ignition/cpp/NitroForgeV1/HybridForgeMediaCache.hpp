#pragma once
#include <NitroForgeV1/HybridForgeMediaCacheSpec.hpp>
#include <NitroForgeV1/ByteCache.hpp>
#include <NitroForgeV1/SerialQueue.hpp>
#include <NitroModules/ThreadPool.hpp>
#include <atomic>
#include <type_traits>
namespace margelo::nitro::nitroforge::ignitionv1 {
class HybridForgeMediaCache final:public HybridForgeMediaCacheSpec {
 struct State{explicit State(size_t capacity):cache(capacity){}::nitroforge::native::ByteCache cache;std::atomic<size_t> bytes{0};bool closed=false;};
 public:
 explicit HybridForgeMediaCache(size_t capacity):_state(std::make_shared<State>(capacity)),_capacity(capacity){}
 double getByteSize()override{return static_cast<double>(_state->bytes.load());}
 Promise<std::optional<ArrayBuffer>> get(const std::string& key)override{return enqueue<std::optional<ArrayBuffer>>([key](State& s){auto value=s.cache.get(key);return value?std::optional<ArrayBuffer>(ArrayBuffer::move(std::move(*value))):std::nullopt;});}
 Promise<void> put(const std::string& key,const ArrayBuffer& bytes)override{
  if(key.empty()||key.size()>1024||bytes.size()>_capacity)throw std::invalid_argument("Cache value exceeds capacity");
  auto owned=ArrayBuffer::copy(bytes);
  return enqueue<void>([key,owned](State& s){s.cache.put(key,std::span<const uint8_t>(owned.data(),owned.size()));});
 }
 Promise<bool> remove(const std::string& key)override{return enqueue<bool>([key](State& s){return s.cache.remove(key);});}
 Promise<void> clear()override{return enqueue<void>([](State& s){s.cache.clear();});}
 Promise<void> close()override{return enqueue<void>([](State& s){s.cache.clear();s.closed=true;},true);}
 protected:
 size_t getExternalMemorySize()noexcept override{return _state->bytes.load();}
 private:
 template<typename T,typename Work>Promise<T> enqueue(Work work,bool closing=false){
  auto promise=Promise<T>::pending();const auto state=_state;
  try{_queue.enqueue([promise,state,work=std::move(work),closing](){try{
    if(state->closed&&!closing)throw std::runtime_error("Media cache is closed");
    if constexpr(std::is_void_v<T>){work(*state);state->bytes.store(state->cache.size());promise.resolve();}
    else{auto value=work(*state);state->bytes.store(state->cache.size());promise.resolve(std::move(value));}
   }catch(...){promise.reject(std::current_exception());}});}catch(...){promise.reject(std::current_exception());}return promise;
 }
 std::shared_ptr<State> _state;size_t _capacity;
 ::nitroforge::native::SerialQueue _queue{[](std::function<void()> work){ThreadPool::shared().run(std::move(work));}};
};
}
