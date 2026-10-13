---
type: milestone
status: done
order: 7
aliases:
  - M7
  - M7 OCCT adaptér
modules:
  - kernel-occt
specs:
  - "[[06-geometricke-jadro]]"
depends_on:
  - "[[M06-regenerace]]"
started: 2026-10-13
finished: 2026-10-13
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-13
---
# M7 – OCCT adaptér

**Cíl:** skutečné geometrické jádro OpenCascade ve WASM, ve Web Workeru, za portem `GeometryKernel`. Kvádr se počítá i tesseluje v OCCT.

**Specifikace:** [[06-geometricke-jadro|06 – geometrické jádro]], [[02-core#RPC pro workery|02 – RPC]], [[0002-occt-wasm-ve-workeru|ADR 0002]], [[0013-replicad-opencascadejs|ADR 0013]]

**Navazuje na:** [[M06-regenerace]]

## Úkoly

- [x] **Spike (časově omezený, ~1 večer na variantu):** vyzkoušet `opencascade.js`, `replicad-opencascadejs` a nastínit vlastní build přes Emscripten. Kritéria: velikost, dostupnost `BRepPrimAPI_MakeBox`, `BRepMesh_IncrementalMesh`, `BRepAlgoAPI_*` s historií, `STEPControl_Writer`, funkčnost v Node pro testy, ve Vite workeru. Výsledek zapsat jako nové ADR (rozhodnutí [[Q012 Volba WASM buildu OCCT|Q012]]).
- [x] Ú1 `core/rpc`: `failAll` a `dispose` ([[Q037 Pád workeru a čekající RPC volání|Q037]]), napojení v `createIdbDocumentStore`.
- [x] Ú2 Závislost OCCT a základ adaptéru: načtení modulu, `Symbol.dispose`, mapy podtvarů (náhrada `TopExp::MapShapes`), převod výjimek OCCT.
- [x] Ú3 `OcctKernelImpl` bez tessellace: tabulka handle, `makeBox` bez rolí ([[Q052 Role ploch kvádru v M7|Q052]]), `boundingBox` (`AddOptimal`), `release`, `liveHandleCount`; uvolňování přes `using`.
- [x] Ú4 Tessellace a kontraktová sada: `BRepMesh_IncrementalMesh`, orientace ploch, normály, `faceRanges`, polyline hran, `edgeRanges`; kontrakt z M5 proti `OcctKernelImpl` v `src/kernel-occt/` ([[Q051 Kde běží kontraktové testy OCCT|Q051]]); paměťový test zrušen ([[Q054 Únik paměti v OCCT buildu|Q054]]).
- [x] Ú5 `occt.worker.ts`, protokol s `ready`, `OcctKernelClient`, `createOcctKernel` (transfer bufferů, `failAll` na `onerror`).
- [x] Ú6 Vite (worker, WASM, `optimizeDeps.exclude`) a dočasná dev stránka.
- [x] Ú7 Ruční ověření v prohlížeči (hlavní sezení): kvádr, počet trojúhelníků, čas, UI během inicializace reaguje; `npm run build` vydá WASM jako asset.
- [x] Při revizi architektury: typovat pole `MeshData` jako `Float32Array<ArrayBuffer>` / `Uint32Array<ArrayBuffer>` (spec 06, `kernel/types.ts`, `validateMeshData`), aby typ vyjádřil „vlastní `ArrayBuffer`, přenositelný“ a odpadla typová stráž v `meshBuffers` (návrh implementátora Ú5).

## Implementační plán

Každý úkol dělá zvlášť subagent `implementer` (TDD: test nejdřív a ověřit, že padá; `npm run check`). Kontrakt je v [[06-geometricke-jadro|spec 06]] (hlavně [[06-geometricke-jadro#`kernel-occt`: architektura adaptéru|architektura adaptéru]]) a [[02-core#RPC pro workery|spec 02]]. Rozhodnutí: [[0013-replicad-opencascadejs|ADR 0013]], [[Q037 Pád workeru a čekající RPC volání|Q037]], [[Q051 Kde běží kontraktové testy OCCT|Q051]], [[Q052 Role ploch kvádru v M7|Q052]]. Ověřené volání API OCCT jsou ve `spikes/m07-occt/replicad/spike.mjs` – implementátor z nich vychází, ne z `.d.ts` (ten slibuje i nesvázané třídy). Ven z `kernel-occt` jde jen `createOcctKernel` přes `index.ts`. Testy smí importovat interní soubory vlastního modulu a `@/kernel/testing`.

### Ú1 `core/rpc`: `failAll` a `dispose`
- **Soubory:** `src/core/rpc/client.ts`, `src/core/rpc/rpc.test.ts`, `src/persistence/idb/index.ts`.
- **Kontrakt:** [[02-core#RPC pro workery]] – rozhraní `RpcClient` a odrážka *Pád spojení*. `RpcClient extends Disposable` z `core`. V `createIdbDocumentStore`: `worker.onerror` a `worker.onmessageerror` → `rpc.failAll(…)` se zprávou z události; `dispose` → `rpc.dispose()` + `worker.terminate()`. `createDocumentStoreClient` bude potřebovat vrátit i klienta RPC (nebo přijmout `RpcClient`), tvar zvol tak, aby `persistence/idb` dál exportovalo jen `createIdbDocumentStore`.
- **Testy:** viz [[02-core#Testy]], odrážka *RPC odpojení* (přes `MessageChannel`). Napojení na `Worker` v `createIdbDocumentStore` se v Node netestuje, ověří ho revize.
- **Hotovo když:** testy a `npm run check` projdou.

### Ú2 Závislost OCCT a základ adaptéru
- **Soubory:** `package.json` (`"replicad-opencascadejs": "1.1.0"` v `dependencies`, přesná verze), `.dependency-cruiser.cjs` (`kernel-occt` dostane `npm: ['replicad-opencascadejs']`), `tsconfig.app.json` a `tsconfig.test.json` (`lib` + `"ESNext.Disposable"`), `src/kernel-occt/occt.ts` (interní), `src/kernel-occt/occt.test.ts`.
- **Kontrakt:**
  - `type Occt` = typ instance modulu z typů balíku (žádné `any`; pokud typ nejde použít, izolovaná výjimka s komentářem jen v `occt.ts`).
  - `loadOcct(options?: { locateWasm?: () => string }): Promise<Occt>`. Nejdřív doplní `Symbol.dispose ??= Symbol.for('Symbol.dispose')` ([[06-geometricke-jadro#`kernel-occt`: architektura adaptéru|spec 06]], odrážka *`using` v prohlížeči*), pak inicializuje modul. V Node bez `locateWasm` (balík si WASM najde sám).
  - `mapSubShapes(oc, shape, type): readonly TopoDS_Shape[]` – `TopExp_Explorer` + odstranění duplicit `IsSame`, pořadí jako `TopExp::MapShapes` (odrážka *Mapy podtvarů*). Explorer uvolní.
  - `toKernelError(oc, e: unknown): Error` – `WebAssembly.Exception` → `createKernelError('internal', '<typ OCCT>: <zpráva>')` přes `getExceptionMessage`; chyba, která už má kód jádra, projde beze změny; cokoli jiného → `'internal'`.
- **Testy:** `loadOcct` v Node vrátí modul a objekty embindu mají `[Symbol.dispose]`; `mapSubShapes` u kvádru 6 / 12 / 8 a plochy v pořadí −X, +X, −Y, +Y, −Z, +Z (ověřit polohou těžiště nebo bounding boxem plochy); `toKernelError` pro výjimku OCCT (záporný rozměr `BRepPrimAPI_MakeBox` → `Standard_DomainError` ve zprávě), pro chybu s kódem jádra a pro obyčejný `Error`. Modul načíst jednou na soubor (`beforeAll`).
- **Hotovo když:** testy a `npm run check` projdou, `lint:deps` hlásí `replicad-opencascadejs` jen z `kernel-occt`.

### Ú3 `OcctKernelImpl` bez tessellace
- **Soubory:** `src/kernel-occt/occt-kernel-impl.ts` (interní třída, ven z modulu nejde), `src/kernel-occt/occt-kernel-impl.test.ts`.
- **Kontrakt:** [[06-geometricke-jadro#Kontrakt (platí pro každou implementaci)]] pro `makeBox`, `boundingBox`, `release`, `liveHandleCount`; [[06-geometricke-jadro#Datové struktury na obou stranách]] (`ShapeEntry` s mapami podtvarů spočítanými při vzniku tvaru). `constructor(oc: Occt)`. Handle = rostoucí čítač od 1. Vstupy validovat a číst synchronně před prvním `await`. `makeBox` bez `roles` a `history`. `boundingBox` přes `BRepBndLib.AddOptimal(shape, box, false, false)`. `release` atomický, uvolní `TopoDS_Shape` i podtvary v `ShapeEntry` (`.delete()`). Dočasné objekty OCCT přes `using`. Každá metoda vrací `Promise` (nikdy synchronní výjimku; `async` bez `await` zakazuje lint) a výjimku převede `toKernelError`. `tessellate` zatím odmítne `'internal'` „not implemented“ (naplní Ú4).
- **Testy:** výběr z kontraktu pro tyto metody (vlastní testy, kontraktová sada se zapojí v Ú4): nové a rostoucí handle, `'invalid-input'` (nekonečno, nula, záporný rozměr), `'unknown-handle'`, atomický `release`, duplicita v `release`, `liveHandleCount`, bounding box přesně `[origin, origin + size]`, izolace vstupu (změna `origin` hned po volání).
- **Hotovo když:** testy a `npm run check` projdou.

### Ú4 Tessellace a kontraktová sada
- **Soubory:** `src/kernel-occt/tessellate.ts` (interní funkce nad `Occt` a `ShapeEntry`), `occt-kernel-impl.ts`, `src/kernel-occt/tessellate.test.ts`, `src/kernel-occt/occt-kernel.contract.test.ts`.
- **Kontrakt:** [[06-geometricke-jadro#Tessellace v adaptéru]], [[06-geometricke-jadro#Síť pro vykreslení]]. Validace kvality → `'invalid-input'`. Nové buffery při každém volání.
- **Testy:** `describeGeometryKernelContract('OcctKernelImpl', …)` – modul OCCT jednou v `beforeAll`, `factory` vytvoří nové `OcctKernelImpl`. Navíc: síť kvádru projde `validateMeshData`, 6 ploch a 12 hran; plocha s orientací `REVERSED` má trojúhelníky CCW zvenku (pokrývá kontrakt přes normály); ~~únik paměti~~ – zrušeno, OCCT ztrácí paměť samo ([[Q053 Citlivost paměťového testu OCCT|Q053]], [[Q054 Únik paměti v OCCT buildu|Q054]]).
- **Hotovo když:** kontraktová sada projde pro `FakeKernel` i `OcctKernelImpl` a `npm run check` je zelený.

### Ú5 Worker, protokol a klient
- **Soubory:** `src/kernel-occt/protocol.ts` (`OcctKernelProtocol`), `src/kernel-occt/worker-impl.ts` (implementace protokolu nad `Promise<OcctKernelImpl>`), `src/kernel-occt/occt.worker.ts`, `src/kernel-occt/client.ts` (`createOcctKernelClient(rpc): GeometryKernel & { ready(): Promise<void> }` – klienta RPC vytváří vlastník workeru, jako u `createDocumentStoreClient(rpc)`), `src/kernel-occt/index.ts` (`createOcctKernel`), testy `worker-impl.test.ts`, `client.test.ts`.
- **Kontrakt:** [[06-geometricke-jadro#Start workeru a `ready`]]. `tessellate` vrací `transfer(mesh, [6 bufferů])`. `occt.worker.ts` volá `serveRpc` synchronně (endpoint adaptér jako v `persistence.worker.ts`) a obsahuje jen zapojení. `createOcctKernel(): Promise<GeometryKernel & Disposable>` podle bodu 3 spec.
- **Testy (Node, `MessageChannel`, bez `Worker`):** volání před dokončením inicializace počká a projde; selhání inicializace → `ready` i další volání odmítnou `'internal'` se zprávou; síť dorazí přes transfer (zdrojové buffery na straně serveru jsou odpojené, `byteLength === 0`); chyba jádra dorazí s kódem čitelným `kernelErrorCode`; `failAll` odmítne čekající volání `'disconnected'`; kontraktová sada přes klienta (`describeGeometryKernelContract('OcctKernelClient over MessageChannel', …)`).
- **Hotovo když:** testy a `npm run check` projdou; `createOcctKernel` (skutečný `Worker`) ověří Ú7.

### Ú6 Vite a dev stránka
- **Soubory:** `vite.config.ts` (`optimizeDeps.exclude: ['replicad-opencascadejs']`, `worker.format: 'es'`), `src/kernel-occt/occt.worker.ts` (`wasmUrl` z `replicad-opencascadejs/wasm?url` do `loadOcct`), `dev/occt.html` + `dev/occt.ts` (dočasné, mimo `src`; přidat do `include` v `tsconfig.app.json`).
- **Kontrakt:** dev stránka zavolá `createOcctKernel()`, změří čas do `ready`, vytvoří kvádr, zavolá `tessellate` a vypíše počet trojúhelníků, ploch, hran a časy. Během inicializace na stránce běží počítadlo snímků (`requestAnimationFrame`), aby šlo vidět, že hlavní vlákno neblokuje.
- **Testy:** žádné automatické (prohlížeč); `npm run build` musí projít a vydat `.wasm` jako asset.
- **Hotovo když:** `npm run check` a `npm run build` projdou.

### Ú7 Ruční ověření (hlavní sezení)
- Dev server, `/dev/occt.html` v prohlížeči: kvádr 12 trojúhelníků, 6 ploch, 12 hran, časy; počítadlo snímků během inicializace roste; v konzoli žádné chyby. Výsledek a screenshot do deníku.

## Akceptační kritéria

- Kontraktové testy jádra projdou pro `FakeKernel`, `OcctKernelImpl` i `OcctKernelClient` přes `MessageChannel`, vše v `npm run check`.
- Kvádr: 6 ploch, 12 hran, `faceRanges` pokrývá všechny trojúhelníky.
- Worker v prohlížeči neblokuje hlavní vlákno (UI reaguje během inicializace WASM).
- Adaptér uvolní všechny objekty OCCT, které vlastní (dočasné přes `using`, `ShapeEntry` při `release`); ověří revize. Halda WASM roste kvůli úniku v samotném OCCT – známé omezení ([[Q054 Únik paměti v OCCT buildu|Q054]]).
- Pád workeru nenechá viset žádné volání: čekající volání skončí `'disconnected'`.
- Build vydá WASM jako samostatný asset. Ověřeno jednorázovým buildem s `dev/occt.html` jako vstupem (aplikace `kernel-occt` zatím neimportuje); trvale hlídá kritérium v [[M10-ui]].

## Co se naučíš

OCCT z pohledu JS/WASM (embind, správa paměti), Vite + workery + WASM, rozdíl mezi desktopovým a webovým nasazením stejného jádra.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

> _Návrh od Clauda – doplň nebo uprav._

**Co bylo jinak, než se čekalo**
- **Spike se vyplatil, ale i spike se mýlil.** Za pár hodin rozhodl build ([[0013-replicad-opencascadejs|ADR 0013]]) a odhalil díry, které `.d.ts` zamlčí (`TopExp::MapShapes`, `IndexedMap`, `HashCode` nejsou svázané). Jeho paměťové měření („s `.delete()` konstantní“) ale bylo chybné: 3000 kol se vešlo do počáteční rezervy 100 MB.
- **Paměť ztrácí samo OCCT** (~11 kB na holý `MakeBox`, v obou WASM buildech), takže kritérium „halda neroste“ nešlo splnit ani ověřit testem ([[Q053 Citlivost paměťového testu OCCT|Q053]] → [[Q054 Únik paměti v OCCT buildu|Q054]]). Přišel na to implementátor tím, že do kódu schválně vložil únik a test pořád prošel. Hledání příčiny se přesunulo do nového [[M16-vlastni-occt-build|M16]].
- **OCCT v unit testech je rychlé** (~100 ms inicializace), takže předpoklad „pomalé integrační testy“ padl a kontraktová sada OCCT běží v `npm run check` ([[Q051 Kde běží kontraktové testy OCCT|Q051]]). Sada teď běží třikrát: `FakeKernel`, `OcctKernelImpl` a klient přes `MessageChannel`.
- **Nejvíc návrhu bylo na hranicích, ne v geometrii:** start workeru bez ztráty zpráv (`ready`), selhání inicializace jako odmítnutí, `failAll` při pádu workeru, přenos bufferů, `using` + polyfill `Symbol.dispose` kvůli převodu ve Vite.
- **Revize našla jen drobnosti**, mimo jiné rozdíl mezi výjimkou OCCT (`WebAssembly.Exception`, řízená) a pádem WASM (`RuntimeError`, poškozený stav) → [[Q055 Pád WASM jádra|Q055]].

**Co se osvědčilo**
- `using` na embind objektech: uvolňování jako RAII v C++, revize ho prošla řádek po řádku bez nálezu úniku v adaptéru.
- Modul OCCT předávaný v konstruktoru a `createOcctWorkerImpl(Promise<GeometryKernel>)`: adaptér i worker jdou testovat v Node bez workeru, části i nad `FakeKernel`.
- Protokol RPC odvozený typem z portu: rozšíření `GeometryKernel` v M11 se neztratí po cestě.
- Implementátoři hlásí díry ve spec jako otázky: vzniklo z nich pět upřesnění spec a dvě otázky.

**Co příště jinak**
- Měření ve spiku ověřit tím, že s chybou spadne (stejně jako test), jinak je to jen dojem.
- Ochranný hook `claude-guard` blokoval podle pracovního adresáře a jeden implementátor ho obešel; opraven tak, aby posuzoval cíle mazání, se self-testem.
