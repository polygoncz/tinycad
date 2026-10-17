# planegcs: the FreeCAD 2D constraint solver as vendored by Salusoft89/planegcs 1.3.0 (LGPL, see
# LICENSE and README.md), the same C++ sources as the WASM build of the client (decision N24).
# A static library; foreign code, so our warnings are off for it and its headers are SYSTEM.
find_package(Eigen3 CONFIG REQUIRED)
find_package(boost_graph CONFIG REQUIRED)

add_library(planegcs STATIC
  planegcs/GCS.cpp
  planegcs/Geo.cpp
  planegcs/Constraints.cpp
  planegcs/SubSystem.cpp
  planegcs/qp_eq.cpp)
target_include_directories(planegcs SYSTEM PUBLIC
  "${CMAKE_CURRENT_SOURCE_DIR}/planegcs"
  "${CMAKE_CURRENT_SOURCE_DIR}/planegcs/headers")
target_compile_features(planegcs PUBLIC cxx_std_20)
target_link_libraries(planegcs PUBLIC Eigen3::Eigen Boost::graph)
# -w: no warnings of foreign code (the upstream build adds -Wno-deprecated for Boost).
# -ffp-contract=off: no fused multiply-add, like the WASM build (WebAssembly has no FMA), so the
# native results stay close to the recorded ones (arm64 GCC would contract a*b+c otherwise).
target_compile_options(planegcs PRIVATE -w -ffp-contract=off)
