cmake_minimum_required(VERSION 3.22)
project(NitroForgeIgnition LANGUAGES CXX)

# The installed package owns the current C++ session and C ABI header. A host
# supplies one Rust archive built for its own target; no source checkout or
# platform-specific JavaScript runtime is needed for this portable layer.
set(NITRO_FORGE_RUST_ARCHIVE "$ENV{NITRO_FORGE_RUST_ARCHIVE}" CACHE FILEPATH "nf-sys static archive built for the consumer target")
if(NOT IS_ABSOLUTE "${NITRO_FORGE_RUST_ARCHIVE}" OR
   NOT EXISTS "${NITRO_FORGE_RUST_ARCHIVE}" OR
   IS_DIRECTORY "${NITRO_FORGE_RUST_ARCHIVE}")
  message(FATAL_ERROR
    "Set NITRO_FORGE_RUST_ARCHIVE to the absolute nf-sys static archive for this target. "
    "The Ignition package does not download or substitute host binaries.")
endif()

find_package(Threads REQUIRED)
add_library(nitroforge_rust STATIC IMPORTED GLOBAL)
set_target_properties(nitroforge_rust PROPERTIES
  IMPORTED_LOCATION "${NITRO_FORGE_RUST_ARCHIVE}")

add_library(nitroforge_rust_session STATIC cpp/ForgeRustSession.cpp)
add_library(NitroForge::RustSession ALIAS nitroforge_rust_session)
target_compile_features(nitroforge_rust_session PUBLIC cxx_std_20)
set_target_properties(nitroforge_rust_session PROPERTIES POSITION_INDEPENDENT_CODE ON)
target_include_directories(nitroforge_rust_session PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/cpp")
target_link_libraries(nitroforge_rust_session PUBLIC
  nitroforge_rust Threads::Threads ${CMAKE_DL_LIBS})
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
  target_link_libraries(nitroforge_rust_session PUBLIC m)
elseif(CMAKE_SYSTEM_NAME STREQUAL "QNX")
  target_link_libraries(nitroforge_rust_session PUBLIC socket)
elseif(WIN32)
  target_link_libraries(nitroforge_rust_session PUBLIC
    bcrypt ntdll userenv ws2_32)
endif()

add_library(nitroforge_serial_queue INTERFACE)
add_library(NitroForge::SerialQueue ALIAS nitroforge_serial_queue)
target_compile_features(nitroforge_serial_queue INTERFACE cxx_std_20)
target_include_directories(nitroforge_serial_queue INTERFACE "${CMAKE_CURRENT_SOURCE_DIR}/cpp")
target_link_libraries(nitroforge_serial_queue INTERFACE Threads::Threads)

include("${CMAKE_CURRENT_SOURCE_DIR}/cmake/NitroForgeBindings.cmake")
