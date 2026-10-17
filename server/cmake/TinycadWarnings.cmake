# tinycad_warnings(<target>): the compiler warnings of our own code (not of generated code).
# Warnings only, no -Werror: the shared headers name constructor parameters like their members,
# which -Wshadow reports.
function(tinycad_warnings target)
  target_compile_options(${target} PRIVATE
    $<$<CXX_COMPILER_ID:GNU,Clang>:-Wall -Wextra -Wpedantic -Wshadow -Wconversion
      -Wno-sign-conversion -Wnon-virtual-dtor -Wold-style-cast>)
endfunction()
