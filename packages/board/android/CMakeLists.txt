cmake_minimum_required(VERSION 3.22.1)
project(NitroForgeBoard LANGUAGES C CXX)

add_library(NitroForgeBoard SHARED src/main/cpp/cpp-adapter.cpp)
target_compile_features(NitroForgeBoard PUBLIC cxx_std_20)

# Nitrogen generates the HybridObject registration and JNI bindings. Do not
# hand-edit these outputs or co-install the incompatible Nitro 0.x runtime.
include(${CMAKE_CURRENT_SOURCE_DIR}/../nitrogen/generated/android/NitroForgeBoard+autolinking.cmake)

# Prefab creates an INTERFACE_LIBRARY when the producer did not build the
# consumer's ABI. Catch that configuration mismatch here, before a linker emits
# hundreds of unresolved Nitro symbols. Nitrogen owns the actual link edge.
get_target_property(NITRO_RUNTIME_TYPE react-native-nitro-modules::NitroModules TYPE)
if(NOT NITRO_RUNTIME_TYPE STREQUAL "SHARED_LIBRARY")
  message(FATAL_ERROR
    "NitroModules has no shared library for ${ANDROID_ABI}. Build Board and NitroModules with the same reactNativeArchitectures.")
endif()

find_library(LOG_LIB log)
target_link_libraries(NitroForgeBoard ${LOG_LIB} android)
target_link_options(NitroForgeBoard PRIVATE "-Wl,-z,max-page-size=16384")
