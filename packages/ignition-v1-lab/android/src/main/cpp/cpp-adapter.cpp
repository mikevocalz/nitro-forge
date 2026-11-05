#include <fbjni/fbjni.h>
#include <jni.h>
#include <NitroForgeV1/private/NitroForgeV1OnLoad.hpp>

// Generated Nitrogen class registry; must be linked with real ForgeRustSession.
JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() {
    margelo::nitro::nitroforge::ignitionv1::registerAllNatives();
  });
}
