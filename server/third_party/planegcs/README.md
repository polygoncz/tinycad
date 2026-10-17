# planegcs (vendored)

The FreeCAD 2D geometric constraint solver *planegcs* as packaged by
[Salusoft89/planegcs](https://github.com/Salusoft89/planegcs), the same C++ sources the npm
package `@salusoft89/planegcs` 1.3.0 compiles to WebAssembly for the tinycad client. The native
server builds them as the static library `planegcs` (`CMakeLists.txt`), so its solver results match
the shared test cases recorded with the WASM build (decision N24 in
`docs/40-plan/Rozhodnutí nativního jádra.md`).

## Origin

- Repository: https://github.com/Salusoft89/planegcs
- Version: npm `1.3.0` = commit `9d26baef0b240fe0eef4186d4e5e5e66ec3620b7` ("1.3.0",
  2026-10-05), one commit after the tag `1.3` (`1ac3ad9`), which differs only in `package.json`.
  The repository has no tag `v1.3.0`; `sketch/gcs_wrapper.ts` of that commit is byte-for-byte the
  one in `node_modules/@salusoft89/planegcs`.
- FreeCAD sources inside it: `planegcs/commit.txt` (FreeCAD commit
  `5f8eac49f31626354ee69bf40616bac801ca5560`), with the patches of the upstream
  `planegcs/update_freecad.sh` already applied.
- Vendored: 2026-10-17.

## What is here

| Path | From upstream |
| --- | --- |
| `planegcs/{GCS,Geo,Constraints,SubSystem,qp_eq}.{cpp,h}`, `Util.h`, `commit.txt` | `planegcs/`, unchanged |
| `planegcs/headers/{FCConfig.h,FCGlobal.h,boost_graph_adjacency_list.hpp}` | `planegcs/headers/`, unchanged |
| `planegcs/headers/Console.h` | `planegcs/headers/Console.h`, **patched** (below) |
| `planegcs/gcs_system.h` | rendered by hand from `templates/` (below) |
| `templates/{gcs_system,add_constraint_functions}.cpp.njk` | `build-bindings/templates/`, unchanged (the source of `gcs_system.h`) |
| `LICENSE` | `LICENSE` (GNU LGPL 2.1) |

Left out: the Embind bindings and their generator (`build-bindings/` except the two templates),
the TypeScript wrapper (`sketch/`, `index.ts`), the emscripten build (`Dockerfile`,
`planegcs/CMakeLists.txt`), tests and documentation. The tinycad adapter
(`server/src/solver-planegcs`) ports the logic of the TypeScript wrapper `sketch/gcs_wrapper.ts`
(parameter order, tags, the default algorithm DogLeg) instead.

## Patches

1. `planegcs/headers/Console.h`: the original logs through emscripten (`EM_JS`, `console.log`);
   the native one writes to stderr with `vfprintf`. planegcs logs only in a debug mode, which the
   adapter turns off (`set_debug_mode(NoDebug)`), as the TS adapter does.
2. `planegcs/gcs_system.h`: upstream generates the class `GcsSystem` into the git-ignored
   `planegcs/bindings.cpp` from `templates/gcs_system.cpp.njk` with a tree-sitter script. Here it
   is rendered by hand for a native build: the same members and bodies, in the namespace
   `planegcs`, without emscripten (`EM_ASM` debug prints in `solve_system`, the
   `EMSCRIPTEN_BINDINGS` block, the make functions of ellipses, hyperbolas and parabolas), and
   with only the `add_constraint_*` functions the adapter uses, each as the template generates it
   from `GCS.h` but without the `scale` parameter (the wrapper always passes 1, which never
   rescales).

No change was needed for GCC 13 / C++20.

## Build

`CMakeLists.txt` builds the static library `planegcs` (C++20) against Eigen 3 and Boost.Graph
from vcpkg (`server/vcpkg.json`). Warnings are off for this foreign code (`-w`; upstream adds
`-Wno-deprecated`) and its include directories are `SYSTEM`. It compiles with
`-ffp-contract=off`: WebAssembly has no fused multiply-add, and without the flag GCC on arm64
would contract `a*b+c` and drift from the recorded WASM results.

## License

GNU Lesser General Public License 2.1 or later (`LICENSE`); the FreeCAD files carry their own
LGPL 2 notices. tinycad links planegcs statically; its sources, including the patches above, are
in this folder.
