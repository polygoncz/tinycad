# tinycad_session: the session layer of the core (spec 14, M45, decisions N53, N154): runtime
# documents with sessions, the edit lease and idempotence, the read model and the events as domain
# data. No protobuf, no gRPC: the rpc layer (tinycad_rpc) converts the results into the tinycad.v1
# messages, and this library does not link tinycad_proto, so a generated message header here
# does not compile.
# Public headers include/tinycad/session/; src/ holds the sources and internal headers.
add_library(tinycad_session STATIC
  src/session_error.cpp
  src/recent_responses.cpp
  src/event_ring.cpp
  src/read_model_builder.cpp
  src/runtime_document.cpp
  src/session_manager.cpp
  src/runtime_support.cpp)
target_include_directories(tinycad_session
  PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include"
  PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src")
target_compile_features(tinycad_session PUBLIC cxx_std_23)
# The solver and the kernel are composed in app (N109): RuntimeDocument gets factories of the
# ports, so this library needs the port headers of tinycad_kernel and tinycad_sketch only.
target_link_libraries(tinycad_session
  PUBLIC tinycad_storage tinycad_regen tinycad_feature_builders tinycad_ops tinycad_features
         tinycad_kernel tinycad_sketch tinycad_document tinycad_core)

tinycad_warnings(tinycad_session)
