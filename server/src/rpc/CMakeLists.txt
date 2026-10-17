# tinycad_rpc: the gRPC layer of the core (spec 14, decisions N53, N154): SessionServiceImpl,
# DocumentServiceImpl and GeometryServiceImpl, the conversions between the tinycad.v1 messages and
# the domain (read model, operations, feature types, Struct ↔ JSON, curves), the fingerprint of a
# request for idempotence and the error statuses (google.rpc.Status with ErrorDetail). The only
# library of the server that knows protobuf and gRPC besides tinycad_proto and tinycad_app; the
# domain under it (session, geometry, document…) does not link them, so the compiler keeps the
# boundary. Public headers include/tinycad/rpc/; src/ holds the sources and internal headers.
#
# SHA-256 of the request fingerprint (N57) comes from OpenSSL's libcrypto, which vcpkg installs
# as a dependency of gRPC.
find_package(OpenSSL REQUIRED)

add_library(tinycad_rpc STATIC
  src/struct_json.cpp
  src/convert.cpp
  src/status.cpp
  src/operation_codec.cpp
  src/feature_types.cpp
  src/fingerprint.cpp
  src/read_model_proto.cpp
  src/session_service.cpp
  src/document_service.cpp
  src/geometry_service.cpp)
target_include_directories(tinycad_rpc
  PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include"
  PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src")
target_compile_features(tinycad_rpc PUBLIC cxx_std_23)
target_link_libraries(tinycad_rpc
  PUBLIC tinycad_session tinycad_geometry tinycad_document tinycad_core tinycad_proto
         gRPC::grpc++
  PRIVATE OpenSSL::Crypto)
tinycad_warnings(tinycad_rpc)
