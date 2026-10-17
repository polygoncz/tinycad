# tinycad_service: the gRPC services over the areas (M39: GeometryService), the conversion
# between proto and domain values and the error statuses of spec 14. Public header
# include/tinycad/service/geometry_service.hpp.
add_library(tinycad_service STATIC
  convert.cpp
  status.cpp
  geometry_service.cpp)
target_include_directories(tinycad_service
  PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include"
  PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")
target_compile_features(tinycad_service PUBLIC cxx_std_23)
target_link_libraries(tinycad_service PUBLIC tinycad_proto tinycad_geometry gRPC::grpc++)
tinycad_warnings(tinycad_service)
