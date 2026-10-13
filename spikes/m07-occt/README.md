# Spike M07: OCCT WASM build

Time-boxed spike that decided Q012 / ADR 0013 (`docs/30-adr/0013-replicad-opencascadejs.md`).
Throwaway code: not linted, not formatted, not part of `npm run check`.

## replicad-opencascadejs (chosen)

```bash
cd spikes/m07-occt/replicad && npm install
node spike.mjs            # box, sub-shape maps, roles, bbox, mesh, edges, boolean history, STEP, errors, `using`
node memory.mjs           # WASM heap growth with and without .delete()
node bindings-probe.mjs   # which NCollection/TopTools containers are actually bound
../../../node_modules/.bin/vite web --config web/vite.config.js   # worker in the browser, http://localhost:5199
```

## opencascade.js 2.0 beta (rejected)

```bash
cd spikes/m07-occt/opencascadejs && npm install && node probe.mjs
```
