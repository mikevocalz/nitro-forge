#include <fbjni/fbjni.h>
#include <NitroForgeV1/private/NitroForgeV1OnLoad.hpp>
JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, [] {
    margelo::nitro::nitroforge::ignitionv1::registerAllNatives();
  });
}
