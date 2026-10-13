---
type: milestone
status: done
order: 5
aliases:
  - M5
  - M5 Port geometrického jádra
modules:
  - kernel
specs:
  - "[[06-geometricke-jadro]]"
depends_on:
  - "[[M01-core]]"
started: 2026-10-13
finished: 2026-10-13
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-12
---
# M5 – Port geometrického jádra

**Cíl:** rozhraní jádra a jeho falešná implementace, aby šla postavit a otestovat regenerace dřív, než přijde OCCT.

**Specifikace:** [[06-geometricke-jadro|06 – geometrické jádro]], [[0002-occt-wasm-ve-workeru|ADR 0002]]

**Navazuje na:** [[M01-core]]

## Úkoly

- [x] `ShapeHandle`, `ShapeResult`, `SubShapeIndex`, `ShapeHistory`, `MeshData`, chyby jádra jako kód (`createKernelError`, `kernelErrorCode`, [[Q039 Chyby jádra přes hranici workeru|Q039]]).
- [x] Segregovaná rozhraní: `PrimitiveOps` (zatím jen `makeBox`), `MeshOps`, `QueryOps` (`boundingBox`), `LifecycleOps`; `GeometryKernel` jako jejich spojení. Ostatní (`TransformOps`, `BooleanOps`, …) se přidají v milnících, které je potřebují.
- [x] Pomocná funkce `validateMeshData` (rozsahy pokrývají všechny trojúhelníky, délky polí sedí) – použije se v testech obou implementací.
- [x] Kontraktové testy `GeometryKernel` (budou se spouštět i proti OCCT v M7).
- [x] `FakeKernel`: kvádry jako AABB, `tessellate` (12 trojúhelníků, 6 ploch, 12 hran), počítání živých handle, `failNext`, `callCount`.

## Akceptační kritéria

- `FakeKernel` projde kontraktovými testy.
- `kernel` importuje jen `core`.
- `FakeKernel` a kontraktová sada jsou jen v `kernel/testing.ts` (nejsou ve veřejném API pro produkční kód).

## Implementační plán

Každý úkol dělá zvlášť subagent `implementer` (TDD: test nejdřív a ověřit, že padá; `npm run check`). Kontrakt je v [[06-geometricke-jadro|spec 06]], úkoly odkazují sekcemi. Veřejné API jen přes `src/kernel/index.ts`, testovací pomůcky přes `src/kernel/testing.ts`.

### Ú1 Typy, rozhraní a chyby
- **Soubory:** `src/kernel/types.ts` (`ShapeHandle`, `BoundingBox`, `MeshQuality`, `ShapeResult`, `SubShapeIndex`, `ShapeHistory`, `HistoryLink`, `MeshData`), `src/kernel/kernel.ts` (`PrimitiveOps`, `MeshOps`, `QueryOps`, `LifecycleOps`, `GeometryKernel`), `src/kernel/errors.ts` (`KernelErrorCode`, `createKernelError`, `kernelErrorCode`), `src/kernel/index.ts`, `errors.test.ts`, `index.test.ts` (seznam runtime exportů).
- **Kontrakt:** [[06-geometricke-jadro#Handle místo tvarů]], [[06-geometricke-jadro#Stav po M5]], [[06-geometricke-jadro#Výsledek operace a historie]], [[06-geometricke-jadro#Síť pro vykreslení]], [[06-geometricke-jadro#Chyby]].
- **Testy:** `kernelErrorCode` podle [[06-geometricke-jadro#Testy]] (vlastní chyba, `RpcError` se stejným kódem, cizí kód, ne-chyba).
- **Hotovo když:** testy a `npm run check` projdou, `kernel` importuje jen `core`.

### Ú2 `validateMeshData`
- **Soubory:** `src/kernel/mesh.ts`, `mesh.test.ts`, export z `index.ts`.
- **Kontrakt:** [[06-geometricke-jadro#Síť pro vykreslení]] (seznam kontrol).
- **Testy:** platná síť (ručně sestavený kvádr nebo dva trojúhelníky) → `[]`; každé pravidlo porušené zvlášť → aspoň jedna zpráva.
- **Hotovo když:** testy a `npm run check` projdou.

### Ú3 Kontraktová sada a `FakeKernel`
- **Soubory:** `src/kernel/testing.ts` (`describeGeometryKernelContract`, re-export `createFakeKernel`, typy `FakeKernel`, `KernelOp`), `src/kernel/fake-kernel.ts` (implementace, skrytá třída), `fake-kernel.test.ts` (spustí sadu + testy `failNext` a `callCount`).
- **Kontrakt:** [[06-geometricke-jadro#Kontrakt (platí pro každou implementaci)]], [[06-geometricke-jadro#FakeKernel]], [[06-geometricke-jadro#Testy]].
- **Testy:** sada napsaná jen proti `GeometryKernel` a `kernelErrorCode` (nezná `FakeKernel`; poběží i proti OCCT v M7, takže žádné předpoklady o pořadí ploch nebo počtu vrcholů). Ověřit, že sada kouše (dočasně rozbít fake: recyklace handle, neatomický `release`, obrácená normála).
- **Hotovo když:** sada projde pro `FakeKernel` a `npm run check` projde. `fake-kernel.ts` importuje jen `testing.ts` a testy (ověřit grepem, dependency-cruiser to uvnitř modulu nehlídá).

## Co se naučíš

Interface segregation, návrh portu tak, aby šel implementovat jak triviálně (fake), tak reálně (OCCT).

## Retrospektiva

> _Návrh od Clauda, Pavel ho chtěl doplnit rovnou._

**Co bylo jinak, než se čekalo**
- Pavlovi se zpočátku nelíbilo procedurální API (`makeBox`, `tessellate`). Diskuze nad objektovou variantou (proxy `Shape` s metodami) skončila u původního tvaru, ale přinesla důležité vyjasnění: obaly kolem tvarů jsou dva a každý drží něco jiného. `ShapeEntry` ve workeru („co OCCT spočítalo“, mapy podtvarů) a `Body` v doméně („co tvar znamená“, stabilní `BodyId`, jména). Port mezi nimi nese jen identitu a hodnoty (viz [[Handle jako klíč, ne objekt]]).
- Poučení z M4 se hned vrátilo: `instanceof KernelError` by přes worker nefungoval, chyby se proto rozpoznávají podle kódu ([[Q039 Chyby jádra přes hranici workeru|Q039]]).
- Většina oprav po revizi byly **implicitní kontrakty**, které fake splňoval náhodou: seřazené `faceRanges` (picking hledá binárně), vlastní `ArrayBuffer` pro každé pole (transfer), čtení vstupů v okamžiku volání (jako `postMessage`), nedeterministický `tessellate`. K tomu tolerance bounding boxu, kterou by OCCT porušil (viz [[Implicitní kontrakty první implementace]]).
- Revize našla i díry v navazujících spec: `render` má z `kernel` jen typy, takže nesmí volat `validateMeshData` ani `FakeKernel`. Dál chyběla kvalita sítě v klíči cache, invalidace cache po restartu jádra a zotavení sweepu při selhání `release` ([[Q040 Selhání release při úklidu handle|Q040]]).

**Co se osvědčilo**
- Kontraktová sada psaná rovnou s ohledem na druhou implementaci (OCCT v M7): nesymetrický kvádr s posunutým originem, normály ven a navinutí, žádné předpoklady o pořadí ploch nebo počtu vrcholů. Že kouše, se ověřilo rozbitím fake (recyklace handle, neatomický `release`, obrácená normála, sdílený buffer).
- `FakeKernel` a sada jen v `testing.ts`. Do produkčního kódu se nedostanou a hranici hlídá dependency-cruiser.
- Rychlé kolo implementer → kontrola → upřesnění spec: drobné rozpory (prázdná plocha × ostré řazení) se vyřešily jedním rozhodnutím a jednou zprávou.

**Co příště jinak**
- U portu psát kontrakt **z pohledu spotřebitelů** (`regen`, `render`) hned na začátku a projít jejich spec. Většina nálezů revize vznikla na švu s `render`, ne v jádru samotném.
