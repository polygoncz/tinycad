# tinycad_kernel: the GeometryKernel port over native OCCT (spec 06, M42; src/kernel and
# src/kernel-occt in TS). Public headers include/tinycad/kernel/*.hpp know no OCCT type; the
# sources and their headers here are internal. One source file per area of the port, so the
# class OcctKernel (occt_kernel.cpp) only delegates (decision N30).
add_library(tinycad_kernel STATIC
  occt_kernel.cpp
  shape_table.cpp
  guarded.cpp
  history.cpp
  errors.cpp
  mesh.cpp
  profile.cpp
  curves2d.cpp
  primitives.cpp
  query.cpp
  transform.cpp
  boolean.cpp
  topology.cpp
  tessellate.cpp
  face.cpp
  sweep.cpp
  regions.cpp
  dressup.cpp
  step.cpp)
target_include_directories(tinycad_kernel
  PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include"
  PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")
target_compile_features(tinycad_kernel PUBLIC cxx_std_23)
# Modelling toolkits and TKDESTEP/TKXSBase for exportStep (decision N25); no visualization.
target_link_libraries(tinycad_kernel
  PUBLIC tinycad_core
  PRIVATE TKernel TKMath TKG2d TKG3d TKGeomBase TKGeomAlgo TKBRep TKTopAlgo TKPrim TKBO
          TKBool TKFillet TKShHealing TKMesh TKDESTEP TKXSBase TKDE)
tinycad_warnings(tinycad_kernel)
