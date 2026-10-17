---
type: milestone
status: done
order: 50
aliases:
  - M50
  - M50 Knihovna occt2d a vrstva rpc
modules:
  - server
specs:
  - "[[06-geometricke-jadro]]"
  - "[[14-protokol]]"
  - "[[01-architektura]]"
depends_on:
  - "[[M47-uklid-a-dokonceni]]"
started: 2026-10-17
finished: 2026-10-17
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M50 – Knihovna occt2d a vrstva rpc

**Cíl:** Server má jeden 2D základ OCCT (`tinycad_occt2d`, N77) a doména nezná protobuf ani gRPC: `RuntimeDocument` vrací doménové výsledky (`session::ReadModel`, `ChangeResult`, `HistoryView`, `SessionEvent`) a převod na zprávy `tinycad.v1` dělá nová vrstva `tinycad_rpc` (N53).

> Upřesněno 2026-10-17 (plánovač, [[Rozhodnutí nativního jádra#Plány M48–M51 (po nativním jádře)|N148, N154]]). Stopa A, po ní [[M51-inverze-a-mereni|M51]]. Průnik se stopou C ([[M49-pravidla-validace-v-popisu|M49]]): převodník popisů typů featur (`feature_types.cpp`) – M50 ho přesouvá, M49 do něj přidává `describeRule`. Kontrakt `param_rule.hpp` + `FeatureSchema::rules()` je zafixovaný v kódu; M50 ho jen nese dál.

**Specifikace:** [[06-geometricke-jadro]], [[14-protokol]], [[01-architektura]]

**Navazuje na:** [[M47-uklid-a-dokonceni]]

## Cílová struktura knihoven

| Knihovna | Obsah po M50 | Závisí na |
|---|---|---|
| `tinycad_occt2d` (nová, **interní**) | `server/src/occt2d`: Geom2d převody (`boundedCurve`, `splineCurve`, `circleCurve`, `splineOf`, `compressKnots`), 2D pomůcky (`samePoint`, `scaleOf`, `startOf`/`endOf`, `counterClockwise`, `arcSweep`…), obálky a jejich průniky (`Box`, `boxOf`, `overlappingPairs`), kontrola křivek (`readCurve`, `knotsProblem`, `CurveRules`) | `tinycad_core`, OCCT (`TKernel`, `TKMath`, `TKG2d`, `TKGeomBase`) veřejně – hlavičky nesou `Handle(Geom2d_Curve)` |
| `tinycad_kernel` | beze změny API; `curves2d.{hpp,cpp}` a kopie kontrol z `profile.cpp` pryč | + `tinycad_occt2d` PRIVATE |
| `tinycad_geometry` | beze změny API; `geom2d.{hpp,cpp}` a kopie kontrol z `validate.cpp` pryč | + `tinycad_occt2d` PRIVATE |
| `tinycad_session` | doména sezení: `RuntimeDocument`, `SessionManager`, `ReadModelBuilder` (doménový), `MeshCache`, `EventRing`, `RecentResponses`, `SessionError` (bez `toStatus`) | storage, regen, feature_builders, ops, features, kernel, sketch, document, core – **bez** `tinycad_proto`, gRPC a OpenSSL |
| `tinycad_rpc` (nová, pohltí `tinycad_service`) | `SessionServiceImpl`, `DocumentServiceImpl`, `GeometryServiceImpl`, převody (`read_model_proto`, `operation_codec`, `feature_types`, `convert`, `struct_json`), `fingerprint` (SHA-256, OpenSSL), stavy chyb (`toStatus` pro `SessionError` i `GeometryService`) | session, geometry, document, core, `tinycad_proto`, gRPC, OpenSSL |
| `tinycad_app` | `CoreServer` skládá služby z `tinycad_rpc` | rpc, session, kernel, solver |

Proč `occt2d` interní (jen `kernel` a `geometry`): její hlavičky nesou typy OCCT, a pravidlo ADR 0030 „veřejné hlavičky domény OCCT neznají“ by jinak padlo. Proč `tinycad_service` zmizí: byla to vrstva rpc pro jednu službu; dvě vrstvy převodů by byly KISS proti.

## Úkoly

- [x] 1. `tinycad_occt2d`: jeden 2D základ, `kernel` a `geometry` nad ním, kopie pryč (N77).
- [x] 2. Doménové výsledky sezení: `session/read_model.hpp`, `session/session_event.hpp`, `RuntimeDocument` a `EventRing` bez typů `tinycad.v1`.
- [x] 3. `tinycad_rpc`: služby, převody, stavy chyb a otisk požadavku přesunuté ze `session` a `service`; `session` bez `tinycad_proto`.
- [x] 4. Ověření: všechny sdílené případy, testy gRPC a e2e beze změny zelené; kontrola, že pod rpc nikdo nevidí `.pb.h`.
- [x] 5. Spec 01, 06, 14 a deník (hlavní sezení).

## Akceptační kritéria

- Žádný 2D kód OCCT dvakrát: `rg -n "compressKnots|overlappingPairs|knotsProblem" server/src` najde definice jen v `server/src/occt2d`.
- `rg -n "pb\.h|grpcpp|google/protobuf" server/src/{core,document,features,ops,storage,occt2d,kernel,geometry,regen,sketch,solver-planegcs,session}` nic nenajde; `tinycad_session` nelinkuje `tinycad_proto` (strukturálně – include `.pb.h` by se nepřeložil).
- Testy gRPC (`grpc_*_test.cpp`) a všechny sdílené případy beze změny obsahu zelené; `npm run check:full` a `npm run test:e2e` zelené.

## Co se naučíš

Jak vést hranici mezi doménou a přenosovým formátem a co stojí převod navíc: doménový read model drží jen sdílená neměnná data (`StudioPtr`, `RegenResult`, `BodyPtr`, `MeshData`), takže převod do protobufu běží **mimo** zámek dokumentu – vrstva navíc tak zámek zkrátí, ne prodlouží.

## Implementační plán

Úkoly 1–4 = jedno spuštění subagenta `implementer` (Opus), v pořadí 1 → 4. Úkol 5 dělá hlavní sezení. Pro všechny:

- **Jen stěhovat a měnit typy na hranici, žádné nové chování.** Odpovědi gRPC musí zůstat bajt po bajtu stejné jako dnes; důkaz jsou testy `grpc_*` a e2e beze změny obsahu.
- **OOP a KISS (N9):** doménové výsledky = obyčejné struktury; převody = volné funkce `xToProto(const X&, v1::X*)` jako dnešní `convert.cpp`; služby jsou třídy.
- **Build v Dockeru nejvýš `-j3` (N116)**; cíleně testy dotčených knihoven, celý `npm run check:full` na konci úkolu 3 a 4 (N2).
- **Před úkolem 3** hlavní sezení sloučí do stopy A `main`, je-li v něm už M49; jinak přenese `describeRule` do rpc slučovatel M49 (N148).

### 1. `tinycad_occt2d`

- **Soubory:** nové `server/src/occt2d/{CMakeLists.txt, curves.cpp, boxes.cpp, curve_checks.cpp}`, `server/src/occt2d/include/tinycad/occt2d/{curves.hpp, boxes.hpp, curve_checks.hpp}`; `server/CMakeLists.txt` (`add_subdirectory(src/occt2d)` před `kernel` a `geometry`, `test/occt2d`); smazat `server/src/kernel/curves2d.{hpp,cpp}`, `server/src/geometry/geom2d.{hpp,cpp}`; upravit `kernel/{profile,face,regions}.cpp`, `geometry/{validate,segment,offset_chain,fillet,offset,intersections}.cpp` a oba `CMakeLists.txt`; nový test `server/test/occt2d/{CMakeLists.txt, occt2d_test.cpp}`.
- **Kontrakt:**

```cpp
// tinycad/occt2d/curves.hpp – namespace tinycad::occt2d
using core::Curve2; using core::Vec2; using Kind = Curve2::Kind;
inline constexpr double kTurn = 2 * std::numbers::pi;
inline constexpr double kPointTolerance = 1e-7;            // spec 06
double dist(Vec2 a, Vec2 b);
bool samePoint(Vec2 a, Vec2 b);
double angleAround(Vec2 center, Vec2 p);
Vec2 onCircle(Vec2 center, double radius, double angle);
double wrap(double x, double m);
double arcSweep(const Curve2& arc);
/** max(1, |extra|, |každá souřadnice|) – sjednocuje dvě dnešní signatury. */
double scaleOf(std::span<const Curve2> curves, double extra = 0);
Curve2 counterClockwise(const Curve2& curve);
Vec2 startOf(const Curve2& curve);
Vec2 endOf(const Curve2& curve);
Handle(Geom2d_Curve) boundedCurve(const Curve2& curve);
Handle(Geom2d_BSplineCurve) splineCurve(const Curve2& spline);
Handle(Geom2d_Curve) circleCurve(Vec2 center, double radius);
struct CompressedKnots { std::vector<double> knots; std::vector<int> multiplicities; };
CompressedKnots compressKnots(const std::vector<double>& flat);
Curve2 splineOf(const Handle(Geom2d_BSplineCurve)& g, double k0, double k1);

// tinycad/occt2d/boxes.hpp
using Box = std::array<double, 4>;
Box boxOf(const Curve2& curve, double tol);
Box unionOf(const Box& a, const Box& b);
bool boxesOverlap(const Box& a, const Box& b);
bool inBox(const Box& b, Vec2 q);
std::vector<std::pair<std::size_t, std::size_t>> overlappingPairs(const std::vector<Box>& boxes);

// tinycad/occt2d/curve_checks.hpp – kontrola jedné křivky na vstupu (spec 06, M29)
struct CurveRules { bool idRequired; bool skipZeroLength; };
enum class CurveRead { Ok, Skip, Bad };
/** Problémy se připíšou do `problems` jako texty s cestou ('curves[2].radius: …'). */
CurveRead readCurve(const Curve2& curve, const std::string& path, std::vector<std::string>& problems, CurveRules rules);
std::optional<std::string> knotsProblem(const std::vector<double>& knots, int degree);
```

  - `geometry/validate.cpp` si `Problems` (sbírá a hází `Failure`) nechá a předá do `readCurve` jeho seznam; `kernel/profile.cpp` dál sbírá do `std::vector<std::string>`. Konstanty `kRadiusTolerance`, `kMaxSplineDegree`, `kMinArcRadius` jdou do `curve_checks.cpp` (jeden zdroj).
  - Když se dvě kopie liší chováním nad rámec `CurveRules` (jiný text je v pořádku – texty se nikdy neporovnávají; jiná podmínka ne), implementátor to vrací jako otázku, nevybírá sám.
  - Mimo rozsah: `kernel/regions.cpp` a `geometry/intersections.cpp` (oblasti vs. průsečíky – jiné algoritmy, ne kopie).
- **Testy:** `occt2d_test.cpp` – `compressKnots`, `samePoint` na hranici tolerance, `overlappingPairs` (dotyk, žádný překryv), konce `boundedCurve` pro úsečku, oblouk a spline, `readCurve` (neplatný uzlový vektor, chybějící id podle pravidel, nulová délka se `Skip`). Hlavní důkaz: `tinycad_kernel_tests`, `tinycad_geometry`/`service` testy a sdílené případy `geometry` a `regen` beze změny zelené.
- **Hotovo když:** testy zelené, akceptační `rg` z kritérií čistý, `rg -n tinycad_occt2d server/src/*/CMakeLists.txt` jen v `occt2d`, `kernel`, `geometry`.

### 2. Doménové výsledky sezení

- **Soubory:** nové `server/src/session/include/tinycad/session/{read_model.hpp, session_event.hpp}`; upravit `runtime_document.{hpp,cpp}`, `read_model_builder.{hpp,cpp}` (doménová část), `event_ring.{hpp,cpp}`, `runtime_support.{hpp,cpp}`, `session_manager.*` jen kde volá změněné API; testy `server/test/session/{runtime_document_test, runtime_document_transactions_test, read_model_builder_test, event_ring_test, mesh_cache_test}.cpp` a `runtime_testing.hpp` na doménové typy.
- **Kontrakt:**

```cpp
// tinycad/session/read_model.hpp
struct ReadModelOptions {
  std::set<std::string> knownMeshes;                 // content_version, které klient má
  std::optional<document::FeatureId> inputOf;        // ADR 0025
};
/** Těleso stavu s verzí obsahu a sítí; mesh == nullptr, když verzi klient uvedl v knownMeshes. */
struct BodyView {
  regen::BodyPtr body;
  std::string contentVersion;
  std::shared_ptr<const kernel::MeshData> mesh;
};
struct SessionView {
  bool writable = false;
  bool canUndo = false;
  bool canRedo = false;
  std::optional<std::string> transactionLabel;       // nullopt = žádná otevřená transakce
};
/** Celý read model jednoho sezení; jen sdílená neměnná data, platí i po uvolnění zámku dokumentu. */
struct ReadModel {
  document::DocumentMeta meta;
  document::StudioPtr studio;                        // featury, rollback, metadata těles
  std::int64_t lastSeq = 0;
  std::uint64_t generation = 0;                      // čítač změn běhového dokumentu (N55)
  regen::RegenResult regen;                          // stavy, finalState, kotvy, input, durationMs
  std::vector<BodyView> bodies;                      // = regen.finalState->bodies(), v pořadí stavu
  std::vector<BodyView> inputBodies;                 // = těla regen.input; prázdné bez input
  SessionView session;
};
struct ChangeResult {
  std::optional<core::Json> entry;                   // LogEntry JSON (storage::Change::entry); nullopt = žádný záznam
  ReadModel readModel;
};
struct HistoryView {
  std::vector<core::Json> entries;                   // LogEntry JSON se seq >= fromSeq
  std::vector<std::int64_t> undoStack;
  std::vector<std::int64_t> redoStack;
};

// tinycad/session/session_event.hpp – uložené události; Resync a Heartbeat jsou jen rpc
struct SessionEvent {
  enum class Kind { Changed, RegenProgress };
  Kind kind = Kind::Changed;
  std::uint64_t seq = 0;                             // přidělí EventRing::append
  std::uint64_t generation = 0;
  std::int64_t lastSeq = 0;                          // Changed
  std::string bySessionId;                           // Changed; "" = DocumentService (rename)
  document::FeatureId featureId;                     // RegenProgress
  regen::FeatureStatus status;                       // RegenProgress
};
```

  - `RuntimeDocument`: každá změnová metoda vrací `SessionResult<ChangeResult>` a bere `const ReadModelOptions&` (místo `v1::ReadModelOptions` a výstupního `v1::ChangeResult*`); `readModel(const Caller&, const ReadModelOptions&, std::uint64_t* eventSeq = nullptr) -> SessionResult<ReadModel>`; `history(std::int64_t fromSeq) -> HistoryView`. Ostatní (zámek, `rename`, `exportStep`, `events()`) beze změny.
  - `ReadModelBuilder::build(const ReadModelInput&, const ReadModelOptions&) -> SessionResult<ReadModel>`: pod zámkem dokumentu jen to, co potřebuje jádro nebo regenerátor – verze obsahu (`Regenerator::contentVersion`) a sítě z `MeshCache` (tessellace). Chyba tessellace → `Internal` jako dnes.
  - `EventRing` ukládá `SessionEvent` (doménový); API `append`, `after`, `waitAfter` stejné, jen typ.
  - Převod `regen::FeatureStatus` → proto (`runtime_support.cpp`) se přesune do rpc v úkolu 3; v úkolu 2 může dočasně zůstat, ale `.pb.h` nesmí zůstat ve veřejných hlavičkách `session`.
- **Invarianty:** (1) `ReadModel` neobsahuje reference ani surové ukazatele do běhového dokumentu; (2) převod nikdy nevolá jádro; (3) `bodies` a `inputBodies` jsou ve stejném pořadí jako stav; (4) zprávy z úkolu 3 musí z těchto dat vyjít bajt po bajtu stejně jako dnešní `ReadModelBuilder`.
- **Testy:** testy běhového dokumentu přepsané na doménové typy (stejné scénáře, stejné počty – výčet změněných asercí do hlášení); `read_model_builder_test` rozdělit: doménová část (verze, sítě podle `knownMeshes`, `input`) zůstane v `test/session`, proto část půjde v úkolu 3 do `test/rpc`.
- **Hotovo když:** `tinycad_session_tests` zelené, veřejné hlavičky `session/include` bez `.pb.h` kromě služeb (`session_service.hpp`, `document_service.hpp`, `feature_types.hpp`, `operation_codec.hpp`, `fingerprint.hpp`, `session_error.hpp`), které úkol 3 přesune.

### 3. Vrstva `tinycad_rpc`

- **Soubory:** nové `server/src/rpc/{CMakeLists.txt, include/tinycad/rpc/*.hpp, src/*.cpp}`; přesunout (git mv, ať zůstane historie) ze `session`: `session_service`, `document_service`, `feature_types`, `operation_codec`, `fingerprint`, `struct_json`, `not_implemented.hpp`, proto část `read_model_builder.cpp` → `read_model_proto.cpp`, proto část `runtime_support.cpp`, `toStatus`/`internalStatusOfCurrentException` ze `session_error.cpp` → `rpc/status.{hpp,cpp}`; ze `service`: `geometry_service`, `convert`, `status` (sloučit se stavy sezení do jednoho `status.cpp`); smazat `server/src/service/`; upravit `server/CMakeLists.txt`, `server/src/session/CMakeLists.txt` (bez `tinycad_proto`, `gRPC::grpc++`, `OpenSSL`), `server/src/app/{CMakeLists.txt, core_server.{hpp,cpp}}`; testy: nový `server/test/rpc/` (přesunout `grpc_*_test.cpp`, `grpc_harness.hpp`, `grpc_documents_harness.hpp`, `feature_types_test`, `operation_codec_test`, `fingerprint_test`, `session_error_test` (část stavů), proto část `read_model_builder_test` a `test/service/geometry_service_test.cpp`), `server/test/session/CMakeLists.txt`, smazat `server/test/service/`.
- **Kontrakt (namespace `tinycad::rpc`):**

```cpp
// tinycad/rpc/read_model_proto.hpp
void readModelToProto(const session::ReadModel& model, v1::ReadModel* out);
void changeResultToProto(const session::ChangeResult& change, v1::ChangeResult* out);
void historyToProto(const session::HistoryView& history, v1::GetHistoryResponse* out);
void sessionEventToProto(const session::SessionEvent& event, v1::SessionEvent* out);
session::ReadModelOptions readModelOptionsOf(const v1::ReadModelOptions& options);

// tinycad/rpc/status.hpp
grpc::Status toStatus(const session::SessionError& error);
grpc::Status internalStatusOfCurrentException();
// + stavy GeometryService (dnešní service/status.hpp) beze změny

// tinycad/rpc/feature_types.hpp (dnešní session/feature_types.hpp, jen jmenný prostor)
void describeFeatureType(const document::FeatureSchema& schema, v1::FeatureTypeDescriptor* out);
std::vector<v1::FeatureTypeDescriptor> describeFeatureTypes(const document::FeatureSchemaRegistryReader& schemas);

// SessionServiceImpl(session::SessionManager& manager, const document::FeatureSchemaRegistryReader& schemas)
//   – popisy typů postaví jednou v konstruktoru (dnes je staví CoreServer a předává vektor).
```

  - Převod read modelu běží v RPC **po** návratu z `RuntimeDocument` (bez zámku dokumentu). Pořadí polí a hodnoty stejné jako dnes (`face_names`, `face_planes` z `body->names()->topology()`, sítě jen kde `mesh != nullptr`).
  - `fingerprint` a `operationKey(const google::protobuf::Message&)` jsou rpc; doména dostává hotový `storage::OperationKey`.
  - `WatchSession` dělá `Resync` a `Heartbeat` sám (jako dnes), uložené události převádí `sessionEventToProto`.
  - `CoreServer` místo `tinycad_service` + služeb ze `session` skládá tři služby z `tinycad_rpc`.
- **Testy:** všechny přesunuté testy zelené beze změny obsahu (mění se jen include, jmenný prostor a cíl CMake); `core_server_test` zelený.
- **Hotovo když:** `npm run check:full` zelený; `server/src/service` neexistuje; akceptační `rg` na `.pb.h` pod rpc čistý.

### 4. Ověření celku

- **Soubory:** žádné nové; případně `scripts/check-server.mjs` jen komentář s novými cíli testů.
- **Postup:** `npm run check:full` (všechny ctest cíle včetně sdílených případů), `npm run test:e2e` proti Compose (obraz jádra se přestaví), akceptační `rg` z kritérií; jednou úmyslná chyba: dočasně `#include "tinycad/v1/read_model.pb.h"` v `session/src/runtime_document.cpp` → build musí spadnout (ověří, že hranice je strukturální), pak vrátit.
- **Hotovo když:** vše zelené, výstup `rg` a výsledek úmyslné chyby v hlášení.

### 5. Specifikace (hlavní sezení)

- [[01-architektura]]: adresářová struktura serveru (`occt2d`, `rpc` místo `service`), pravidlo „doména serveru nezná protobuf“.
- [[06-geometricke-jadro]]: `tinycad_occt2d` jako společný interní 2D základ.
- [[14-protokol]]: vrstva rpc, převod read modelu mimo zámek dokumentu (oddíl „Vlákna a zámky serveru“).

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_Návrh Clauda (stopa A)._

- `tinycad_occt2d` (interní, jen kernel a geometry) nahradil obě kopie 2D základu; `tinycad_rpc` převzal `service` a gRPC části `session`. Doména (`session` a níž) protobuf nezná – hlídá to překladač (úmyslný include `.pb.h` neprojde).
- Přesun `feature_types.cpp` jako čistý `git mv` v samostatném commitu: git při sloučení M49 sledoval přejmenování a `describeRule` přešel bez konfliktu (N148).
- `check:server` 1769, `check` 5857 unit / 332 integračních, `test:e2e` 104 zelené.
