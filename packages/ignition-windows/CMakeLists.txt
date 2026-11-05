cmake_minimum_required(VERSION 3.24)
project(ForgeWindowsWorker LANGUAGES CXX)

option(NF_WINDOWS_BUILD_TESTS "Build the RNW worker's real Rust tests" OFF)

# The same wrapper and nf-sys ABI used by the Nitro v1 implementation.
# No additional Rust engine, C ABI, or generated Nitro runtime is introduced.
add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../ignition-native" native)

add_library(forge_windows_worker STATIC
  cpp/DocumentSessions.cpp
  cpp/ForgeWorker.cpp)
target_include_directories(forge_windows_worker PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/cpp")
target_compile_features(forge_windows_worker PUBLIC cxx_std_20)
target_link_libraries(forge_windows_worker PUBLIC forge_rust_session)
set_target_properties(forge_windows_worker PROPERTIES CXX_EXTENSIONS OFF)

if(MSVC)
  target_compile_options(forge_windows_worker PRIVATE /W4 /WX /EHsc)
else()
  target_compile_options(forge_windows_worker PRIVATE -Wall -Wextra -Werror)
endif()

if(WIN32)
  add_library(forge_windows_codec STATIC cpp/SnapshotCodec.cpp)
  target_include_directories(forge_windows_codec PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/cpp")
  target_compile_features(forge_windows_codec PUBLIC cxx_std_20)
  target_link_libraries(forge_windows_codec PUBLIC crypt32)
  target_compile_options(forge_windows_codec PRIVATE /W4 /WX /EHsc)
endif()

if(NF_WINDOWS_BUILD_TESTS)
  enable_testing()
  add_executable(forge_windows_worker_test tests/worker_test.cpp)
  target_link_libraries(forge_windows_worker_test PRIVATE forge_windows_worker)
  add_test(NAME windows_worker_real_rust COMMAND forge_windows_worker_test)
  set_tests_properties(windows_worker_real_rust PROPERTIES TIMEOUT 30)
  if(WIN32)
    add_executable(forge_windows_codec_test tests/snapshot_codec_test.cpp)
    target_link_libraries(forge_windows_codec_test PRIVATE forge_windows_codec)
    add_test(NAME windows_snapshot_codec COMMAND forge_windows_codec_test)
    set_tests_properties(windows_snapshot_codec PROPERTIES TIMEOUT 30)
  endif()
endif()

# ForgeWindowsModule.cpp requires RNW's generated WinRT headers. It is compiled
# by the actual RNW application through windows/ForgeWindows.props, not by this
# portable CMake target. A passing CMake test is not RNW module/runtime proof.
