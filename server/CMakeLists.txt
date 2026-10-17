# tinycad-core: the native core of tinycad (ADR 0030). Dependencies come from vcpkg in
# manifest mode (vcpkg.json); build it with a preset of CMakePresets.json, in Docker
# (server/Dockerfile). Each area is a library tinycad_<area> in src/<area>/ with public headers
# in src/<area>/include/tinycad/<area>/ and declares cxx_std_23 itself (decisions N10, N25);
# this file only wires the areas together.
cmake_minimum_required(VERSION 3.25)

project(tinycad_core VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# The folder with the shared test cases (test/shared-cases of the repository, spec 13).
set(TINYCAD_SHARED_CASES_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../test/shared-cases"
    CACHE PATH "Folder with the shared test cases (test/shared-cases)")

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
include(TinycadDependencies)
include(TinycadWarnings)

enable_testing()

add_subdirectory(third_party/planegcs)

add_subdirectory(src/proto)
add_subdirectory(src/core)
add_subdirectory(src/geometry)
add_subdirectory(src/sketch)
add_subdirectory(src/solver-planegcs)
add_subdirectory(src/service)
add_subdirectory(src/app)

add_subdirectory(test/support)
add_subdirectory(test/service)
add_subdirectory(test/shared-cases)
add_subdirectory(test/sketch)
add_subdirectory(test/solver-planegcs)
