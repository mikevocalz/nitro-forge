cmake_minimum_required(VERSION 3.22.1)
project(NitroForgeV1)
add_library(NitroForgeV1 SHARED
  src/main/cpp-adapter.cpp
  ../cpp/ForgeRustSession.cpp
  ../cpp/HybridForgeFactory.cpp
  ../cpp/HybridForgeDocument.cpp)
target_include_directories(NitroForgeV1 PRIVATE ../cpp)
include(../nitrogen/generated/android/NitroForgeV1+autolinking.cmake)
set(FORGE_RUST_ARCHIVE "${CMAKE_CURRENT_SOURCE_DIR}/../native/android/${ANDROID_ABI}/libnf_sys.a")
if(NOT EXISTS "${FORGE_RUST_ARCHIVE}")
  message(FATAL_ERROR "Missing ${FORGE_RUST_ARCHIVE}. Run packages/ignition/scripts/build-android.sh with the app NDK first.")
endif()
add_library(ForgeRust STATIC IMPORTED)
set_target_properties(ForgeRust PROPERTIES IMPORTED_LOCATION "${FORGE_RUST_ARCHIVE}")
target_link_libraries(NitroForgeV1 ForgeRust android log)
