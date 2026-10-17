# tinycad_core: value types shared by every area (Vec2, Plane, Curve2, StrongId, Result), their
# JSON and text helpers (trimJs); the C++ mirror of src/core (decision N11).
add_library(tinycad_core STATIC
  curve2.cpp
  json.cpp
  text.cpp)
target_include_directories(tinycad_core PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include")
target_compile_features(tinycad_core PUBLIC cxx_std_23)
target_link_libraries(tinycad_core PUBLIC nlohmann_json::nlohmann_json)
tinycad_warnings(tinycad_core)
