# Host supplies Khronos headers; no downloaded code or loader linked implicitly.
find_path(PERSONA_OPENXR_INCLUDE_DIR openxr/openxr.h REQUIRED)
add_library(nitroforge_persona_openxr src/xr_tracking.cpp)
target_link_libraries(nitroforge_persona_openxr PUBLIC nitroforge_persona)
target_compile_features(nitroforge_persona_openxr PUBLIC cxx_std_17)
target_include_directories(nitroforge_persona_openxr PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>
  ${PERSONA_OPENXR_INCLUDE_DIR})
set_target_properties(nitroforge_persona_openxr PROPERTIES POSITION_INDEPENDENT_CODE ON)
if(BUILD_TESTING)
  add_executable(persona_xr_rig_test tests/xr_rig_test.cpp)
  target_link_libraries(persona_xr_rig_test PRIVATE nitroforge_persona_openxr)
  add_test(NAME persona_xr_rig COMMAND persona_xr_rig_test)
  add_executable(persona_openxr_test tests/xr_tracking_test.cpp)
  target_link_libraries(persona_openxr_test PRIVATE nitroforge_persona_openxr)
  add_test(NAME persona_openxr COMMAND persona_openxr_test)
endif()
install(TARGETS nitroforge_persona_openxr ARCHIVE DESTINATION lib LIBRARY DESTINATION lib RUNTIME DESTINATION bin)
install(DIRECTORY include/ DESTINATION include)
