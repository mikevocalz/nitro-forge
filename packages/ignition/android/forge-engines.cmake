# Engine selection check for the Android build.
#
# Inputs:
#   NITRO_FORGE_ENGINES       "all" or comma-separated engine names, from the
#                             nitroForge.engines Gradle property (written by
#                             the Expo config plugin's engines option).
#   FORGE_RUST_ENGINES_FILE   engines.txt that build-android.sh writes next to
#                             each libnf_sys.a, listing what the archive links.
#
# Fails configure when the app needs an engine the archive left out, so the
# gap shows at build time instead of as an open() error on device.
# Script-mode tests (cmake -P) have no cmake_minimum_required to set this.
cmake_policy(SET CMP0057 NEW)
set(FORGE_KNOWN_ENGINES prism cadence splice folio pitch tally quill photo motion design draft scene)

function(forge_engine_list out value source)
  string(STRIP "${value}" value)
  if(value STREQUAL "all")
    set(${out} ${FORGE_KNOWN_ENGINES} PARENT_SCOPE)
    return()
  endif()
  string(REPLACE "," ";" names "${value}")
  set(result "")
  foreach(name IN LISTS names)
    string(STRIP "${name}" name)
    if(NOT name IN_LIST FORGE_KNOWN_ENGINES)
      message(FATAL_ERROR "[Nitro Forge] ${source} has unknown engine '${name}'. Known engines: ${FORGE_KNOWN_ENGINES}")
    endif()
    if(name IN_LIST result)
      message(FATAL_ERROR "[Nitro Forge] ${source} lists ${name} twice.")
    endif()
    list(APPEND result ${name})
  endforeach()
  if(NOT result)
    message(FATAL_ERROR "[Nitro Forge] ${source} must name at least one engine.")
  endif()
  set(${out} ${result} PARENT_SCOPE)
endfunction()

if(NOT DEFINED NITRO_FORGE_ENGINES OR NITRO_FORGE_ENGINES STREQUAL "")
  set(NITRO_FORGE_ENGINES "all")
endif()
forge_engine_list(FORGE_REQUESTED_ENGINES "${NITRO_FORGE_ENGINES}" "nitroForge.engines")

if(EXISTS "${FORGE_RUST_ENGINES_FILE}")
  file(READ "${FORGE_RUST_ENGINES_FILE}" forge_archived_text)
  string(STRIP "${forge_archived_text}" forge_archived_text)
  forge_engine_list(FORGE_ARCHIVED_ENGINES "${forge_archived_text}" "${FORGE_RUST_ENGINES_FILE}")
  set(forge_missing "")
  foreach(name IN LISTS FORGE_REQUESTED_ENGINES)
    if(NOT name IN_LIST FORGE_ARCHIVED_ENGINES)
      list(APPEND forge_missing ${name})
    endif()
  endforeach()
  if(forge_missing)
    string(REPLACE ";" "," forge_missing "${forge_missing}")
    string(REPLACE ";" "," forge_wanted "${FORGE_REQUESTED_ENGINES}")
    message(FATAL_ERROR "[Nitro Forge] The Rust archive links ${forge_archived_text} but the app needs ${forge_missing}. Rerun packages/ignition/scripts/build-android.sh with NF_ENGINES=${forge_wanted}.")
  endif()
  set(forge_extra "")
  foreach(name IN LISTS FORGE_ARCHIVED_ENGINES)
    if(NOT name IN_LIST FORGE_REQUESTED_ENGINES)
      list(APPEND forge_extra ${name})
    endif()
  endforeach()
  if(forge_extra)
    message(WARNING "[Nitro Forge] The Rust archive also links ${forge_extra}, which nitroForge.engines leaves out; they still ship in the app.")
  endif()
elseif(NOT NITRO_FORGE_ENGINES STREQUAL "all")
  message(WARNING "[Nitro Forge] ${FORGE_RUST_ENGINES_FILE} is missing, so the archive's engines cannot be checked against nitroForge.engines. Rebuild with build-android.sh.")
endif()
