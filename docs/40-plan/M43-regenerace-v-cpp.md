---
type: milestone
status: todo
order: 43
aliases:
  - M43
  - M43 Regenerace a featury v C++
modules:
  - server
specs:
  - "[[07-regenerace]]"
  - "[[08-topologicke-pojmenovani]]"
depends_on:
  - "[[M40-dokument-a-operace-v-cpp]]"
  - "[[M42-jadro-occt-nativne]]"
started:
finished:
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M43 – Regenerace a featury v C++

**Cíl:** `Regenerator` s cache podle identity featury, statusy, kotvami, mark & sweep a `content_version`; topologické pojmenování; buildery všech vestavěných featur kromě skici. Ověřeno sdílenými případy `regen` bez skic z [[M38-zmrazeni-domeny|M38]] a property testem.

> Upřesněno 2026-10-17 při plánování samostatného běhu ([[Rozhodnutí nativního jádra]], N40–N46). Stopa B souběžných stop po [[M39-kostra-serveru|M39]]: před startem natáhne `main` se sloučeným [[M40-dokument-a-operace-v-cpp|M40]] ([[Roadmapa#Nativní jádro (M38–M47)]]).

**Specifikace:** [[07-regenerace]] (celá: *Builder featury*, *Kotvy manipulátorů*, *Operace tělesa*, *Stav featury*, *Regenerator*, *Cache podle identity*, *Životnost handle*, *Testy*), [[08-topologicke-pojmenovani]], [[13-testovani#Sdílené testovací případy]] (druh `regen`), [[14-protokol#Read model a sítě]] (`content_version`), [[0030-nativni-jadro-pres-grpc|ADR 0030]]

**Navazuje na:** [[M40-dokument-a-operace-v-cpp]] (model dokumentu, registr schémat, schémata vestavěných featur), [[M42-jadro-occt-nativne]] (`GeometryKernel`, `OcctKernel`)

**Zdroj pravdy o chování:** zmrazené `src/regen/*.ts` a `src/features/{box,cylinder,boolean,transform,extrude,revolve,fillet,chamfer}/builder.ts` s testy `test/unit/regen/*` a `test/unit/features/<name>/<name>.test.ts` (části builderu); spouštěč `test/integration/shared-cases/regen.test.ts` se `support/{sort,mesh-volume}.ts`.

## Úkoly

- [ ] 1. Kostra `tinycad_regen` a `tinycad_feature_builders`, stav, tabulka jmen a sledované jádro
- [ ] 2. Řešení referencí, roviny ploch, operace tělesa a testovací podpora (souběžně s 3)
- [ ] 3. `Regenerator`: cache, statusy, kotvy, sweep a `content_version` (souběžně s 2)
- [ ] 4. Buildery Box, Cylinder, Boolean, Transform, Fillet, Chamfer a spouštěč sdílených případů `regen` (souběžně s 5)
- [ ] 5. Buildery Extrude a Revolve a property test regenerace (souběžně s 4)

Úkol 1 jde první a sám a založí všechny zdrojové soubory obou knihoven s pahýly (N30), úkoly 2 a 3 pak běží souběžně, po jejich sloučení souběžně 4 a 5. Builder skici a sdílené případy se skicami jsou v [[M44.1-builder-skici-na-serveru|M44.1]] (N46).

**Kontrakt pro [[M44.1-builder-skici-na-serveru|M44.1]] a [[M45-sezeni-pres-grpc|M45]]:** hlavičky `server/src/regen/include/tinycad/regen/{state,names,builder,body_operation,face_plane,content_version,regenerator}.hpp` a `server/src/features/include/tinycad/features/builders.hpp` (N40–N45). M44.1 z nich bere `FeatureBuilder`, `BuildContext::resolvePlanes`, `SketchArtifact` a `RegenState::with`; M45 `Regenerator`, `RegenResult`, `RegenObserver` a `Regenerator::contentVersion`.

### Rozdělení sdílených případů `regen` (N46)

39 případů v `test/shared-cases/regen/`: **24 bez skici v M43**, 15 se skicou v M44.1. Spouštěč M43 přeskočí pevný seznam 15 případů (ne podle chyby), M44.1 seznam smaže.

| Milník | Případy |
|---|---|
| M43 (24) | `boolean-intersect-apart-kernel-error`, `boolean-intersect-boxes`, `boolean-subtract-boxes`, `boolean-subtract-cylinder`, `boolean-union-boxes`, `boolean-unresolved-tool`, `box`, `chamfer-box-edge`, `chamfer-too-large`, `fillet-box-edge`, `fillet-hole-edge`, `fillet-too-large`, `fillet-unresolved-after-deleted-box`, `input-of-fillet`, `input-of-first-feature`, `input-of-rolled-back-feature`, `input-of-suppressed-feature`, `input-of-unknown-feature`, `invalid-params-zero-height`, `rolled-back-features`, `suppressed-feature`, `transform-rotate-bodies-center`, `transform-translate`, `unknown-type` |
| [[M44.1-builder-skici-na-serveru\|M44.1]] (15) | `extrude-add-on-top-face`, `extrude-rectangle`, `extrude-remove-hole`, `extrude-unresolved-region`, `extrude-up-to-face`, `input-of-extrude-on-top-face`, `revolve-full-turn-origin-axis`, `revolve-full-turn-sketch-line`, `sketch-bspline-extrude`, `sketch-circular-pattern-extrude`, `sketch-fitspline-extrude`, `sketch-spline-crossing-warning`, `sketch-spline-with-hole-extrude`, `sketch-text-construction`, `sketch-text-extrude` |

Extrude a Revolve tak v M43 ověří jen unit testy nad `aSketchArtifact` (plochy z `makeFace` přímo, jako `src/regen/testing.ts`); v sestavě je ověří případy M44.1.

## Akceptační kritéria

- 24 sdílených případů `regen` bez skici zelených v C++ (GoogleTest v Dockeru) se stejným porovnáním a řazením jako TS spouštěč ([[13-testovani#Sdílené testovací případy]]: objem z jemné sítě s `relative` 1e-3, plochy a hrany podle jmen, řazení se zaokrouhlením na 6 míst, issues seřazené jako `schema.validate`).
- **Property test** (N28): regenerace s cache = regenerace od nuly (stejný popis výsledku jako ve spouštěči: statusy, tělesa, kotvy) a po každém kroku `kernel.liveHandleCount() == ownedHandleCount() ==` počet živých handle (žádný únik).
- Testy ze [[07-regenerace]] (sekce *Testy*) bez souběhu generací, událostí `started`/`finished` a ztraceného jádra (N40) projdou nad `OcctKernel` s počítajícím dekorátorem (N45).
- `content_version`: těleso převzaté z cache nebo nezměněné featurou má stejnou verzi, nový tvar novou; dva `Regenerator`y mají různé prefixy (N43).
- `tinycad_regen` a `tinycad_feature_builders` nemají ve zdrojích typy OCCT (jen port jádra), `tinycad_features` (schémata) na nich nezávisí (N44).

## Implementační plán

Jeden úkol = jedno spuštění subagenta `implementer` (Opus, TDD). Pro všechny úkoly:

- **OOP a KISS** (Pavel, N9): malá hierarchie artefaktů s `kind()` a `as<T>()`, `NameTable`, `TrackingKernel` jako dekorátor portu, `BuildContext`, `Regenerator` s pimpl, jedna třída `FeatureBuilder` na featuru (`BoxBuilder`, …) v `server/src/features/<name>/builder.{hpp,cpp}`. Žádné šablonové metaprogramování, žádné funkcionální řetězce, žádný `std::variant` s visitorem; `switch` nad `kind`. Neměnnost stavů přes `shared_ptr<const …>` (N17, N41).
- **Kontrakt:** zafixované hlavičky výše a hlavičky M40 a M42. Implementátor je **nemění** (výjimka: jména parametrů, `#include`); chybějící funkci vrací jako otázku. Vnitřní hlavičky v `src/` navrhuje sám.
- **Chyby:** builder vrací `BuildResult`; chybu jádra předá `core::fail(kernelFailure(r.error()))` (status `KERNEL`) nebo ji převede sám (Fillet, Chamfer, Extrude `upToFace`), N40. Výjimka z builderu je chyba programu: `run` uklidí a výjimku pustí dál (Q043). Texty chyb a varování se netestují, jen kódy, cesty a počet zpráv varování.
- **Build:** `server/src/regen/CMakeLists.txt` (`tinycad_regen`: `tinycad_document`, `tinycad_kernel`), `server/src/features/CMakeLists.txt` doplní `tinycad_feature_builders` (`tinycad_features`, `tinycad_regen`); testy `server/test/regen/*_test.cpp` (`tinycad_regen_tests`), `server/test/features/*_builder_test.cpp` (`tinycad_feature_builders_tests`), spouštěč `server/test/shared-cases/regen_cases_test.cpp` nad `tinycad_test_support` (N25).
- **Jádro v testech** (N45): skutečný `OcctKernel` (nativně rychlý), žádný port `FakeKernel`. Počítání volání a vložené selhání dělá `CountingKernel` v `server/test/regen/testing.hpp` (dekorátor `GeometryKernel`: počet volání podle metody, `failNext(method, KernelError)`), testovací buildery `CubeBuilder`/`SpyBuilder` (počet volání, volitelná vlastní funkce build) a schéma `aSchema()` jako `src/regen/testing.ts`.
- **Matice:** `core` nemá operace s `Mat4`; Transform a Extrude si translaci, rotaci kolem osy a násobení napíšou v `server/src/features/common/mat4.{hpp,cpp}` (vnitřní, sloupcově jako `src/core/math/mat4.ts`). Kdyby je potřeboval i někdo mimo buildery, přesune je hlavní sezení do `core`.
- **Ověření:** cílené testy v Dockeru (`ctest -R "regen|feature_builders|shared_cases_regen"`); celý `npm run check` při sloučení stopy (N2).

### 1. Kostra, stav, tabulka jmen a sledované jádro

- **Soubory:** `server/src/regen/CMakeLists.txt`; `src/state.cpp` (artefakty, `RegenState` včetně `empty()`, `with`, `replaceBodies`, statusy a jména kódů), `src/names.cpp` (`NameTable`, `propagateNames`, `nameShape` – port `names.ts` pravidlo po pravidlu), `src/tracking_kernel.cpp`, `src/build_context.cpp` (konstruktor, `kernel()`, `state()`, `warn`, `warnings`; metody `resolve*` jako pahýly vracející `RefError` „not implemented“), `src/builder.cpp` (`FeatureBuilderRegistry`, `unresolvedReference`, `kernelFailure`), pahýly `src/{face_plane,body_operation,content_version,regenerator}.cpp`; `server/src/features/CMakeLists.txt` (+ `tinycad_feature_builders`), `server/src/features/builders.cpp` (`registerBuiltInBuilders` v pořadí hlavičky) a `server/src/features/<name>/builder.{hpp,cpp}` pro osm featur jako pahýly (`build` vrací `kernelFailure` „not implemented“); testy `server/test/regen/{state,names,name_shape,tracking_kernel,builder}_test.cpp`.
- **Kontrakt:** `state.hpp`, `names.hpp`, `builder.hpp`. `RegenState::empty()` = roviny xy, xz, yz, pak osy x, y, z z `document::ORIGIN_PLANES`/`ORIGIN_AXES`. `propagateNames`: pravidla 1–8 spec 08 včetně kontextu hrany `[…]` a `#k` podle středu (tolerance 1e-9, pak index), švu `edge:A|A`, plochy bez jména, `generatedTag`; nezávislé na pořadí historie a rolí; index mimo rozsah nebo neznámý vstup → `AssertionError`; vstup bez topologie (`NameTable::empty()`) se nekontroluje. `TrackingKernel` přidá handle jen u úspěšného výsledku.
- **Testy:** port `test/unit/regen/{state,names,name-shape,tracking-kernel,builder}.test.ts` (ručně sestavené historie a topologie bez jádra; `nameShape` nad `OcctKernel` s kvádrem); `RegenState::with` nahradí na místě a nový artefakt přidá na konec; `replaceBodies` (consumed vyhrává, cizí id se nepřidá, ostatní tentýž ukazatel).
- **Hotovo když:** testy zelené, obě knihovny se přeloží se všemi soubory, `registerBuiltInBuilders` zaregistruje osm builderů.

### 2. Reference, roviny ploch, operace tělesa a testovací podpora (souběžně s 3)

- **Soubory:** `server/src/regen/src/{build_context,face_plane,body_operation}.cpp`, `server/test/regen/testing.hpp` (`aSketchArtifact(owner, faces, plane, lines)` – oblasti `r1`, `r2`, … s obrysem jednotkové kružnice jako TS; `aBuildContext`; `aNameTable`; `CountingKernel`; `CubeBuilder`, `SpyBuilder`, `aSchema`), testy `server/test/regen/{build_context,face_plane,body_change,body_operation}_test.cpp`.
- **Kontrakt:** `builder.hpp` (`BuildContext::resolve*`), `face_plane.hpp`, `body_operation.hpp`. `resolvePlanes` u `TopoRef`: plocha s nejmenším indexem, víc ploch → jedno varování na referenci; `resolveTopo` u ploch varuje, u hran ne; `resolveAxis` u entity skici hledá v `SketchArtifact::lines` (chybějící id i jiný druh entity → `RefError`), převod do světa přes rovinu skici (`x·xDir + y·(normal × xDir) + origin`). `applyBodyOperation`: pořadí volání jádra deterministické (tvary po jednom, cíle po jednom), `New` s více tvary jedno `union`, `Add` jedno `union` s prvním cílem, `Remove`/`Intersect` každý cíl zvlášť; jména podle pravidel spec 08.
- **Testy:** port `test/unit/regen/{build-context,face-plane,body-change,body-operation}.test.ts` nad `OcctKernel` (každá větev chyb `RefError`; `sketchPlaneOfFace` pro ±X, ±Y, ±Z a šikmou normálu; horní plocha kvádru → rovina `z = h`; všechny čtyři operace tělesa s identitou, pořadím v mapě a jmény; sledované jádro zapíše handle `makeFace`, `extrude`, `revolve`, `fillet`, `chamfer`).
- **Hotovo když:** testy zelené.

### 3. `Regenerator`, sweep a `content_version` (souběžně s 2)

- **Soubory:** `server/src/regen/src/{regenerator,content_version}.cpp`, testy `server/test/regen/{regenerator,regenerator_anchors,regenerator_input,regenerator_sweep,content_version}_test.cpp`. Testovací buildery a `CountingKernel` si úkol 3 do sloučení úkolu 2 vytvoří lokálně v `server/test/regen/regenerator_support.hpp`; při sloučení se sjednotí s `testing.hpp` (hlášení to uvede).
- **Kontrakt:** `regenerator.hpp`, `content_version.hpp`. Kroky cache 1–5 spec 07 s identitou `FeaturePtr`; pořadí kontrol v buildu: potlačená → `suppressed`, chybí schéma nebo builder → `UNKNOWN_TYPE`, `typeVersion` ≠ verze schématu → `STALE_VERSION`, `evaluateParams` s issues → `INVALID_PARAMS` (issues ze schématu, builder se nevolá), chyba builderu → `error`, varování → `warning`. Kotvy jen u `ok`/`warning` před lištou (i z cache). `input` podle ADR 0025. Sweep po každém `run` (i po výjimce builderu nebo pozorovatele, před jejím puštěním dál): živé = `Body::shape` a `SketchArtifact::regions[].face` všech stavů v cache, ostatní vlastněné jedním `release`; `UnknownHandle` → `TINYCAD_ASSERT`, jiná chyba → handle zůstanou vlastněné. Destruktor uvolní všechny vlastněné handle. `RegenObserver::featureDone` pro každou featuru právě jednou v pořadí featur (z cache hned na začátku, přepočítaná po buildu, `rolledBack` na konci). `contentVersion(body)` = `ContentVersions::of(body.shape())`; prefix `<ms startu procesu>-<čítač instancí>` (N43).
- **Testy:** port `test/unit/regen/{regenerator,regenerator-anchors,regenerator-input,regenerator-sweep}.test.ts` bez souběhu, událostí a `disconnected` (N40): změna featury 3 z 5 přepočítá jen 3–5; posun lišty dozadu i zpět dopředu nevolá jádro; chybná featura propustí stav; `INVALID_PARAMS`, `UNKNOWN_TYPE`, `STALE_VERSION` bez volání builderu; status z cache se zachová; dvakrát `warn` = jedna zpráva s `\n`; `failNext('makeBox')` → `KERNEL` s issue `kernel.operationFailed`; výjimka builderu → `run` vyhodí a handle se uklidí; builder s mezivýsledkem a chybou → handle uvolněný; `release` selže `Internal` → úklid při dalším běhu; `durationMs` z pevných hodin; po sekvenci změn `liveHandleCount() == ownedHandleCount()`; `content_version` podle akceptačních kritérií.
- **Hotovo když:** testy zelené.

### 4. Buildery Box, Cylinder, Boolean, Transform, Fillet, Chamfer a spouštěč `regen` (souběžně s 5)

- **Soubory:** `server/src/features/{box,cylinder,boolean,transform,fillet,chamfer}/builder.{hpp,cpp}`, `server/src/features/common/mat4.{hpp,cpp}`, testy `server/test/features/{box,cylinder,boolean,transform,fillet,chamfer}_builder_test.cpp`; spouštěč `server/test/shared-cases/regen_cases_test.cpp` s pomocníky `server/test/shared-cases/support/{regen_describe,mesh_volume}.{hpp,cpp}` (port `regen.test.ts`, `support/mesh-volume.ts`, řazení `compareIssues`, `normalizeOutline`, `sortKey` ze `support/sort.ts`, pokud je `tinycad_test_support` z úkolu 0 ještě nemá).
- **Kontrakt:** chování přesně podle `builder.ts` každé featury a pravidel identity spec 07: Transform (matice `T(translate) · T(p) · Rz · Ry · Rx · T(−p)`, kotva `pivot` jen pro `bodiesCenter`, každé těleso zvlášť přes `modifyBody`), Boolean (jeden výsledek s identitou prvního cíle, `keepTools`, vstupy jmen v pořadí volání jádra), Fillet a Chamfer (hrany seskupené podle tělesa v pořadí prvního výskytu, jedno volání na těleso, `generatedTag` `fillet`/`chamfer`, `OperationFailed` → `INVALID_PARAMS` s `fillet.failed` u `radius` / `chamfer.failed` u `distance`). Spouštěč: `fromData` s `registerBuiltInSchemas`, nový `Regenerator` s `registerBuiltInBuilders` a hodinami `0` pro každý případ, popis výsledku jako TS (statusy v pořadí featur, tělesa podle `id`, plochy a hrany podle jmen a signatur, `vertexCount`, objem ze sítě `linearDeflection` 0,01 / `angularDeflection` 0,05, `sketches` prázdné, `anchors`, `input` jen s `inputOf`); seznam 15 přeskočených případů pevně v kódu s odkazem na M44.1.
- **Testy:** port částí builderu z `test/unit/features/{box,cylinder,boolean,transform,fillet,chamfer}/*.test.ts` (identita, jména, kotvy, chybové větve).
- **Hotovo když:** 24 sdílených případů zelených.

### 5. Buildery Extrude a Revolve a property test (souběžně s 4)

- **Soubory:** `server/src/features/{extrude,revolve}/builder.{hpp,cpp}`, testy `server/test/features/{extrude,revolve}_builder_test.cpp`, `server/test/regen/regenerator_property_test.cpp`.
- **Kontrakt:** podle `extrude/builder.ts` a `revolve/builder.ts`: Extrude jeden hranol na oblast v pořadí oblastí, `flip` jen pro `blind`, `symmetric` posune profil o −d/2, `upToFace` délka pro každou oblast z roviny plochy (`resolvePlanes`, nerovnoběžná nebo za profilem → `INVALID_PARAMS` `extrude.upToFace` u `upTo`, tolerance 1e-9), kotva `base` (střed sjednocené obálky ploch oblastí promítnutý do roviny skici, směr normála) jen pro `blind` a `symmetric`; Revolve osa z `resolveAxis`, úhel z parametrů, operace tělesa přes `applyBodyOperation`. Oba bez skici: testy staví stav s `aSketchArtifact` a plochami z `makeFace`.
- **Property test** (N28): `std::mt19937` se semínkem, 100 sekvencí po 1–20 krocích nad featurami Box, Cylinder, Boolean, Transform, Fillet a Chamfer (přidání, smazání, změna parametru, potlačení, posun lišty, přesun featury, i kroky vedoucí k chybám) – po každém kroku výsledek `Regenerator` s cache = výsledek nového `Regenerator`u (popis jako spouštěč úkolu 4; do jeho sloučení stačí srovnání statusů, id těles, objemů a jmen) a žádný únik handle. Při selhání vypíše semínko a nejkratší selhávající prefix.
- **Testy:** port částí builderu z `test/unit/features/{extrude,revolve}/*.test.ts` (všechny operace, `upToFace`, kotvy a jejich invariant: kotva nezávisí na `distance` ani `flip`).
- **Hotovo když:** testy zelené, celá sada stopy B zelená v jednom běhu, revize `architecture-reviewer` na konci milníku.

## Co se naučíš

Regenerace s cache podle identity ukazatele, mark & sweep nad nativním jádrem, topologické pojmenování v C++ a co odpadne, když regenerace nemusí být asynchronní (generace, `superseded`, ztracené jádro).

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
