#include <NitroForgeBluetoothV1/private/NitroForgeBluetoothV1OnLoad.hpp>
#include <fbjni/fbjni.h>
#include <jni.h>
JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, [] {
    margelo::nitro::forgebluetooth::registerAllNatives();
  });
}
