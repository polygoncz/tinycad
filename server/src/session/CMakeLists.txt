# tinycad_session: the session layer of the core (spec 14, M45, decision N53): runtime documents
# with sessions, the edit lease and idempotence, the read model written straight into the
# tinycad.v1 messages, and the gRPC adapters SessionServiceImpl and DocumentServiceImpl. Public
# headers include/tinycad/session/; src/ holds the sources and internal headers.
#
# SHA-256 of the request fingerprint (N57) comes from OpenSSL's libcrypto, which vcpkg installs
# as a dependency of gRPC.
find_package(OpenSSL REQUIRED)

add_library(tinycad_session STATIC
  src/struct_json.cpp
  src/session_error.cpp
  src/operation_codec.cpp
  src/feature_types.cpp
  src/fingerprint.cpp
  src/recent_responses.cpp
  src/event_ring.cpp
  src/read_model_builder.cpp
  src/runtime_document.cpp
  src/session_manager.cpp
  src/session_service.cpp
  src/document_service.cpp
  src/runtime_support.cpp
  # TEMPORARY until M44.1 merges (see the file): delete together with the file.
  src/sketch_operation_solver_pending.cpp)
target_include_directories(tinycad_session
  PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include"
  PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src")
target_compile_features(tinycad_session PUBLIC cxx_std_23)
# The solver and the kernel are composed in app (N109): RuntimeDocument gets factories of the
# ports, so this library needs the port headers of tinycad_kernel and tinycad_sketch only.
target_link_libraries(tinycad_session
  PUBLIC tinycad_storage tinycad_regen tinycad_feature_builders tinycad_ops tinycad_features
         tinycad_kernel tinycad_sketch tinycad_document tinycad_core tinycad_proto gRPC::grpc++
  PRIVATE OpenSSL::Crypto)

tinycad_warnings(tinycad_session)
