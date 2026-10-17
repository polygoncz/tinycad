# tinycad_regen: regeneration of the feature history (spec 07, spec 08, M43), the C++ mirror of
# src/regen. Public headers include/tinycad/regen/*.hpp (the contract of the main session); the
# sources and their internal headers live in src/. Only the kernel PORT is used: no OCCT type in
# this library (decision N44).
add_library(tinycad_regen STATIC
  src/state.cpp
  src/names.cpp
  src/tracking_kernel.cpp
  src/build_context.cpp
  src/builder.cpp
  src/face_plane.cpp
  src/body_operation.cpp
  src/content_version.cpp
  src/regenerator.cpp)
target_include_directories(tinycad_regen
  PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include"
  PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src")
target_compile_features(tinycad_regen PUBLIC cxx_std_23)
target_link_libraries(tinycad_regen PUBLIC tinycad_document tinycad_kernel tinycad_core)
tinycad_warnings(tinycad_regen)
