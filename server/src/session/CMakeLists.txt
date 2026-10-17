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
  src/document_service.cpp)
target_include_directories(tinycad_session
  PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include"
  PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src")
target_compile_features(tinycad_session PUBLIC cxx_std_23)
target_link_libraries(tinycad_session
  PUBLIC tinycad_ops tinycad_features tinycad_kernel tinycad_sketch tinycad_solver_planegcs
         tinycad_document tinycad_core tinycad_proto gRPC::grpc++
  PRIVATE OpenSSL::Crypto)

# TODO(M45 merge of tracks A and B): link tinycad_storage (M41), tinycad_regen and
# tinycad_feature_builders (M43/M44.1) instead of reaching their headers directly. Until those
# libraries exist on this branch the session code uses only their headers (types, no calls).
target_include_directories(tinycad_session PUBLIC
  "${PROJECT_SOURCE_DIR}/src/storage/include"
  "${PROJECT_SOURCE_DIR}/src/regen/include")

tinycad_warnings(tinycad_session)
