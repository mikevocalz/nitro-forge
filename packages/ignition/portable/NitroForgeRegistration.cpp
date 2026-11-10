#include <NitroForgeV1/NitroForgeRegistration.hpp>
#include <NitroForgeV1/NitroForgeV1Autolinking.hpp>

#include <mutex>

namespace nitroforge::native {

void registerNitroForgeClasses() {
  static std::once_flag registered;
  std::call_once(registered, [] {
    margelo::nitro::nitroforge::ignitionv1::registerHybridClasses();
  });
}

} // namespace nitroforge::native
