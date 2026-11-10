cmake_minimum_required(VERSION 3.22)

# Invoked by the generic installed-package loader, only when an application has
# selected Ignition. The host owns Nitro and its Qt/JavaScript dispatcher.
if(NOT TARGET rnqnx_nitro_core OR NOT TARGET rnqnx_nitro_qt)
  message(FATAL_ERROR "Ignition Qt needs the host's matching Nitro core and real Qt JavaScript dispatcher")
endif()
add_subdirectory("${CMAKE_CURRENT_LIST_DIR}/.." "${CMAKE_CURRENT_BINARY_DIR}/ignition")
nitroforge_add_nitro_bindings(NITRO_TARGET rnqnx_nitro_core)
