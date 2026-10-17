# tinycad_geometry: the 2D sketch geometry over OCCT behind GeometryService (spec 14, M39).
# Public header include/tinycad/geometry/geometry.hpp; the sources and their headers here are
# internal (OCCT never shows in the public header).
add_library(tinycad_geometry STATIC
  validate.cpp
  touching.cpp
  intersections.cpp
  segment.cpp
  fillet.cpp
  offset.cpp
  offset_chain.cpp
  geometry.cpp)
target_include_directories(tinycad_geometry
  PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include"
  PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")
target_compile_features(tinycad_geometry PUBLIC cxx_std_23)
target_link_libraries(tinycad_geometry
  PUBLIC tinycad_core
  PRIVATE tinycad_occt2d
          TKernel TKMath TKG2d TKG3d TKGeomBase TKGeomAlgo TKBRep TKTopAlgo TKOffset)
tinycad_warnings(tinycad_geometry)
