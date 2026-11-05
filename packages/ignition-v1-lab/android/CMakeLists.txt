cmake_minimum_required(VERSION 3.22.1)
project(NitroForgeV1 LANGUAGES C CXX)

set(PACKAGE_NAME NitroForgeV1)
set(NF_RUST_STATIC "${CMAKE_CURRENT_SOURCE_DIR}/../native/android/${ANDROID_ABI}/libnf_sys.a")
if(NOT EXISTS "${NF_RUST_STATIC}")
  message(FATAL_ERROR
    "NitroForgeV1: missing real Rust staticlib for ${ANDROID_ABI}: ${NF_RUST_STATIC}. "
    "Run tooling/native/build_nf_v1_artifacts.sh android before Gradle.")
endif()

add_library(${PACKAGE_NAME} SHARED
  src/main/cpp/cpp-adapter.cpp
  ../cpp/ForgeRustSession.cpp
  ../cpp/ForgeSerialQueue.cpp
  ../cpp/HybridForgeFactory.cpp
  ../cpp/HybridForgeDocument.cpp
)
target_compile_features(${PACKAGE_NAME} PUBLIC cxx_std_20)
target_include_directories(${PACKAGE_NAME} PRIVATE "../cpp")

include(${CMAKE_CURRENT_SOURCE_DIR}/../nitrogen/generated/android/NitroForgeV1+autolinking.cmake)

add_library(nf_sys STATIC IMPORTED GLOBAL)
set_target_properties(nf_sys PROPERTIES IMPORTED_LOCATION "${NF_RUST_STATIC}")

find_library(LOG_LIB log)
target_link_libraries(${PACKAGE_NAME}
  nf_sys
  ${LOG_LIB}
  android
  m
)
