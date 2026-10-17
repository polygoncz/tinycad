# Command-line tools of the native core, shipped in the runtime image next to tinycad-core.
#
# tinycad-import: the one-off migration of documents exported from the browser (`.tinycad.json`
# with history) into the SQLite catalog (M41, decision N38).
add_executable(tinycad-import tinycad_import.cpp)
target_compile_features(tinycad-import PRIVATE cxx_std_23)
target_link_libraries(tinycad-import PRIVATE tinycad_storage tinycad_features OpenSSL::Crypto)
tinycad_warnings(tinycad-import)
