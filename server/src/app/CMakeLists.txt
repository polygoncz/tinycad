# tinycad-core: the gRPC server executable over the service area.
add_executable(tinycad-core main.cpp)
target_compile_features(tinycad-core PRIVATE cxx_std_23)
target_link_libraries(tinycad-core PRIVATE tinycad_service gRPC::grpc++ Threads::Threads)
tinycad_warnings(tinycad-core)
