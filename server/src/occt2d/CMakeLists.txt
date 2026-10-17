# tinycad_occt2d: the one 2D base over OCCT (decision N77): Geom2d curves of core::Curve2, small
# 2D helpers, boxes and their overlapping pairs, the check of one input curve. Internal: its
# headers carry OCCT types (Handle(Geom2d_Curve)), so only tinycad_kernel and tinycad_geometry
# link it, privately; no public header of the domain shows OCCT (ADR 0030, decision N154).
add_library(tinycad_occt2d STATIC
  curves.cpp
  boxes.cpp
  curve_checks.cpp)
target_include_directories(tinycad_occt2d PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include")
target_compile_features(tinycad_occt2d PUBLIC cxx_std_23)
target_link_libraries(tinycad_occt2d
  PUBLIC tinycad_core TKernel TKMath TKG2d TKGeomBase)
tinycad_warnings(tinycad_occt2d)
