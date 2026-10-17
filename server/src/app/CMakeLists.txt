# tinycad_app: the composition root of the core (CoreServer: registries, catalog, sessions, the
# three gRPC services, the reaper thread); a library so test/app can start the composed server.
# tinycad-core: the executable around it (environment, signals, OCCT messages).
add_library(tinycad_app STATIC core_server.cpp)
target_include_directories(tinycad_app PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}")
target_compile_features(tinycad_app PUBLIC cxx_std_23)
# The solver and the kernel are composed here (N109).
target_link_libraries(tinycad_app
  PUBLIC tinycad_rpc tinycad_session gRPC::grpc++ Threads::Threads
  PRIVATE tinycad_kernel tinycad_solver_planegcs tinycad_feature_builders tinycad_features)
tinycad_warnings(tinycad_app)

add_executable(tinycad-core main.cpp)
target_compile_features(tinycad-core PRIVATE cxx_std_23)
# TKernel: the process-wide OCCT messenger is quieted in main (N78).
target_link_libraries(tinycad-core PRIVATE tinycad_app TKernel)
tinycad_warnings(tinycad-core)
