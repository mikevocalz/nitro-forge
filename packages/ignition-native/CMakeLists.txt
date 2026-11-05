cmake_minimum_required(VERSION 3.24)

if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
  project(ForgeNative LANGUAGES CXX)
endif()

# The host supplies a library compiled for its own target. In particular, a QNX
# build must never silently run Cargo for the Linux build machine.
set(NF_RUST_LIBRARY "" CACHE FILEPATH "Absolute path to the target's nf-sys static library")
set(NF_RUST_SYSTEM_LIBRARIES "" CACHE STRING "Additional target libraries reported by rustc --print native-static-libs")
option(NF_BUILD_TESTS "Build standalone Forge native integration tests" OFF)

if(NOT IS_ABSOLUTE "${NF_RUST_LIBRARY}" OR NOT EXISTS "${NF_RUST_LIBRARY}" OR IS_DIRECTORY "${NF_RUST_LIBRARY}")
  message(FATAL_ERROR "NF_RUST_LIBRARY must name an existing absolute path to the target's nf-sys static library. Build nf-sys for the host/target explicitly; this package does not run Cargo.")
endif()
if(TARGET forge_rust_session OR TARGET forge_serial_queue)
  message(FATAL_ERROR "Add packages/ignition-native only once; reuse forge_rust_session and forge_serial_queue in other adapters.")
endif()
if(WIN32 AND NOT MSVC)
  message(FATAL_ERROR "The Windows host currently requires MSVC and an *-pc-windows-msvc Rust library.")
endif()

get_filename_component(NF_SOURCE_ROOT "${CMAKE_CURRENT_LIST_DIR}/../.." ABSOLUTE)
set(NF_SESSION_SOURCE_DIR "${NF_SOURCE_ROOT}/packages/ignition-v1-lab/cpp")
find_package(Threads REQUIRED)

add_library(forge_rust_abi STATIC IMPORTED GLOBAL)
set_target_properties(forge_rust_abi PROPERTIES
  IMPORTED_LOCATION "${NF_RUST_LIBRARY}"
  INTERFACE_INCLUDE_DIRECTORIES "${NF_SOURCE_ROOT}/rust/nf-sys/include"
)
target_link_libraries(forge_rust_abi INTERFACE Threads::Threads ${CMAKE_DL_LIBS})
if(WIN32)
  # Rust's MSVC standard library dependencies. Hosts must match the architecture
  # and CRT selection of their Rust archive; see README.md.
  target_link_libraries(forge_rust_abi INTERFACE
    advapi32 bcrypt dbghelp kernel32 ntdll userenv ws2_32
  )
elseif(CMAKE_SYSTEM_NAME STREQUAL "QNX")
  target_link_libraries(forge_rust_abi INTERFACE m socket)
elseif(APPLE)
  find_library(NF_CORE_FOUNDATION CoreFoundation REQUIRED)
  target_link_libraries(forge_rust_abi INTERFACE "${NF_CORE_FOUNDATION}")
elseif(CMAKE_SYSTEM_NAME STREQUAL "Linux")
  target_link_libraries(forge_rust_abi INTERFACE m rt util)
else()
  message(FATAL_ERROR "Forge native linkage is not specified for ${CMAKE_SYSTEM_NAME}. Supply a reviewed platform integration before enabling this target.")
endif()
target_link_libraries(forge_rust_abi INTERFACE ${NF_RUST_SYSTEM_LIBRARIES})

add_library(forge_rust_session STATIC "${NF_SESSION_SOURCE_DIR}/ForgeRustSession.cpp")
target_include_directories(forge_rust_session PUBLIC "${NF_SESSION_SOURCE_DIR}")
target_compile_features(forge_rust_session PUBLIC cxx_std_20)
target_link_libraries(forge_rust_session PUBLIC forge_rust_abi)
set_target_properties(forge_rust_session PROPERTIES POSITION_INDEPENDENT_CODE ON CXX_EXTENSIONS OFF)

add_library(forge_serial_queue STATIC "${NF_SESSION_SOURCE_DIR}/ForgeSerialQueue.cpp")
target_include_directories(forge_serial_queue PUBLIC "${NF_SESSION_SOURCE_DIR}")
target_compile_features(forge_serial_queue PUBLIC cxx_std_20)
target_link_libraries(forge_serial_queue PUBLIC Threads::Threads)
set_target_properties(forge_serial_queue PROPERTIES POSITION_INDEPENDENT_CODE ON CXX_EXTENSIONS OFF)

if(NF_BUILD_TESTS)
  enable_testing()
  add_executable(forge_shared_engine_roundtrip "${NF_SOURCE_ROOT}/tooling/native/shared_engine_roundtrip.cpp")
  target_link_libraries(forge_shared_engine_roundtrip PRIVATE forge_rust_session)
  add_executable(forge_serial_queue_test "${NF_SOURCE_ROOT}/tooling/native/serial_queue_test.cpp")
  target_link_libraries(forge_serial_queue_test PRIVATE forge_serial_queue)
  foreach(test_target forge_shared_engine_roundtrip forge_serial_queue_test)
    if(MSVC)
      target_compile_options(${test_target} PRIVATE /W4 /WX /EHsc)
    else()
      target_compile_options(${test_target} PRIVATE -Wall -Wextra -Werror)
    endif()
  endforeach()
  add_test(NAME forge_tally_write COMMAND forge_shared_engine_roundtrip write "${CMAKE_CURRENT_BINARY_DIR}/tally-roundtrip.nfd")
  set_tests_properties(forge_tally_write PROPERTIES FIXTURES_SETUP tally_document TIMEOUT 30)
  add_test(NAME forge_tally_reopen COMMAND forge_shared_engine_roundtrip read "${CMAKE_CURRENT_BINARY_DIR}/tally-roundtrip.nfd")
  set_tests_properties(forge_tally_reopen PROPERTIES FIXTURES_REQUIRED tally_document TIMEOUT 30)
  add_test(NAME forge_serial_queue COMMAND forge_serial_queue_test)
  set_tests_properties(forge_serial_queue PROPERTIES TIMEOUT 30)
endif()
