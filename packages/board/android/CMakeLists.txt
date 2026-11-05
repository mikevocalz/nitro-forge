cmake_minimum_required(VERSION 3.22.1)
project(NitroForgeBoard LANGUAGES C CXX)

add_library(NitroForgeBoard SHARED src/main/cpp/cpp-adapter.cpp)
target_compile_features(NitroForgeBoard PUBLIC cxx_std_20)

# Nitrogen generates the HybridObject registration and JNI bindings. Do not
# hand-edit these outputs or co-install the incompatible Nitro 0.x runtime.
include(${CMAKE_CURRENT_SOURCE_DIR}/../nitrogen/generated/android/NitroForgeBoard+autolinking.cmake)

find_library(LOG_LIB log)
target_link_libraries(NitroForgeBoard ${LOG_LIB} android)
target_link_options(NitroForgeBoard PRIVATE "-Wl,-z,max-page-size=16384")
