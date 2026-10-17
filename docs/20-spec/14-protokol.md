---
type: spec
status: draft
order: 14
aliases:
  - Protokol
  - Spec 14
  - gRPC kontrakt
modules:
  - server
milestones:
  - "[[M39-kostra-serveru]]"
  - "[[M45-sezeni-pres-grpc]]"
  - "[[M46-klient-nad-read-modelem]]"
  - "[[M49-pravidla-validace-v-popisu]]"
  - "[[M50-occt2d-a-vrstva-rpc]]"
tags:
  - spec
created: 2026-10-17
updated: 2026-10-17
---
# 14 – Protokol klienta a nativního jádra

> **Pojmy:** [[Sezení]], [[Read model]], [[Idempotentní požadavek]], [[Operace]], [[Transakce]], [[Port a adaptér]]  
> **Rozhodnutí:** [[0030-nativni-jadro-pres-grpc|ADR 0030]], [[Q094 Nativní jádro na serveru přes gRPC|Q094]], [[Q096 Geometrie skici přes síť|Q096]], [[Q097 Transakce a undo přes RPC|Q097]], [[Q098 Schéma featur v klientovi|Q098]], [[Q099 Read model po regeneraci|Q099]], [[Q100 Verze sítí v mezipaměti klienta|Q100]], [[Q101 Operace v kontraktu proto|Q101]], [[Q102 Sezení pro více karet|Q102]], [[Q104 Nástroje pro kontrakt a C++ server|Q104]], [[Q105 Viditelnost parametru jako data|Q105]]  
> **Moduly klienta:** `src/protocol` (vygenerovaný kód, ne v gitu) a `src/remote` (adaptéry), [[Q106 Moduly klienta pro gRPC|Q106]]  
> **Milník:** [[M39-kostra-serveru]] (kostra a `GeometryService`), [[M45-sezeni-pres-grpc]] (`SessionService`), [[M46-klient-nad-read-modelem]] (klient)

Kontrakt mezi prohlížečem a nativním C++ jádrem `tinycad-core`. Zdrojem pravdy o **syntaxi** jsou soubory `server/proto/tinycad/v1/*.proto` (balík `tinycad.v1`, kontrola `buf lint` a `buf breaking`). Tato specifikace říká **proč** a **jak se to chová**: sémantiku volání, invarianty a testy. Ukázky níže jsou zkrácené.

## Přehled

```
Prohlížeč                         Envoy (grpc_web)            tinycad-core (C++)
──────────                        ────────────────            ──────────────────
remote/ adaptéry  ── gRPC-Web ──► překlad na gRPC  ── gRPC ─► DocumentService
  SketchGeometry                  timeouty, health            SessionService ── běhový dokument ── SQLite soubor
  sezení, read model                                          GeometryService (bezstavová)
```

| Služba | Stav na serveru | K čemu |
|---|---|---|
| `DocumentService` | katalog dokumentů | seznam, vytvoření, přejmenování, smazání, import a export `.tinycad.json` |
| `SessionService` | [[Sezení]] nad běhovým dokumentem | otevření, operace, transakce, undo, read model, události, STEP |
| `GeometryService` | žádný | 2D geometrie skicáře za portem `SketchGeometry` ([[Q096 Geometrie skici přes síť|Q096]]) |

Soubory: `common.proto` (vektory, rovina, `ParamIssue`), `errors.proto` (`ErrorDetail`), `operations.proto`, `schema.proto` (`FeatureTypeDescriptor`), `read_model.proto`, `geometry.proto`, `session.proto` (obě služby s dokumenty a sezením).

### Vrstva rpc na serveru

Od [[M50-occt2d-a-vrstva-rpc|M50]] ([[Rozhodnutí nativního jádra|N53, N154]]) zná protobuf a gRPC na serveru jen knihovna `tinycad_rpc` (`server/src/rpc`) a kompoziční kořen `tinycad_app`. Doména pod ní (`session`, `storage`, `regen`, `geometry`…) `tinycad_proto` nelinkuje, takže `.pb.h` v ní nejde přeložit.

```
SessionServiceImpl / DocumentServiceImpl / GeometryServiceImpl      (tinycad_rpc)
   │ request → doménové vstupy: operationToJson, readModelOptionsOf, operationKey (otisk)
   ▼
SessionManager → RuntimeDocument (zámek dokumentu)                  (tinycad_session)
   │ vrací doménové výsledky: session::ReadModel, ChangeResult, HistoryView;
   │ EventRing drží session::SessionEvent
   ▼
readModelToProto, changeResultToProto, historyToProto, sessionEventToProto,
toStatus (SessionError → google.rpc.Status)                         (tinycad_rpc, mimo zámek)
```

- **Doménový read model** (`session/read_model.hpp`) drží jen sdílená neměnná data: `DocumentMeta`, `StudioPtr`, kopii `RegenResult` (stavy, `StatePtr`, kotvy, vstup), pro každé těleso `BodyPtr` s verzí obsahu a `shared_ptr<const MeshData>` (`nullptr`, když verzi klient uvedl v `known_meshes`) a pohled sezení. Pod zámkem dokumentu se dělá jen to, co potřebuje jádro nebo regenerátor (regenerace, verze obsahu, tessellace do `MeshCache`); `regen.input` zůstane jen tehdy, když ho `input_of` žádal.
- **Převod do protobufu běží v RPC po návratu z `RuntimeDocument`**, tedy bez zámku dokumentu, a nikdy nevolá jádro. Vrstva navíc zámek zkrátí, ne prodlouží. Odpovědi jsou bajt po bajtu stejné jako před M50 (testy `grpc_*` beze změny).
- `WatchSession` dělá `resync` a `heartbeat` sám; uložené události převádí `sessionEventToProto`.
- `SessionServiceImpl` postaví popisy typů featur (`describeFeatureTypes`) jednou v konstruktoru z registru schémat.
- Stavy chyb jsou v `rpc/status.hpp`: `toStatus` a `internalStatusOfCurrentException` pro sezení a dokumenty (`ERROR_REASON_UNSPECIFIED`), `geometryStatus` a `internalGeometryStatusOfCurrentException` pro `GeometryService` (`KERNEL_INTERNAL`).

## Čtyři zásady

Z [[Q094 Nativní jádro na serveru přes gRPC|Q094]]. Stabilitu „odkudkoli“ dělají ony, ne Envoy.

1. **Sezení nezávislé na spojení.** Jádro drží dokument pod `session_id`, ne pod TCP spojením. Výpadek sítě nic nezavře.
2. **Idempotentní změny.** Každý měnící požadavek nese `operation_id` ([[Idempotentní požadavek]]).
3. **Navazovaný stream.** Události mají `seq`, klient se po výpadku připojí s posledním přijatým.
4. **Typované chyby.** `google.rpc.Status` a v podrobnostech `ErrorDetail` s doménovým kódem, ne text.

## Pravidla tvaru kontraktu

- **Každé RPC má vlastní request a response** (pravidlo `buf lint` STANDARD). Sdílený obsah je ve vnitřní zprávě (`ChangeResult`, `DocumentSummary`). Proč: kontrakt žije dlouho a každé volání se pak dá rozšířit o pole, aniž by se změnila ostatní.
- **Čísla polí se nikdy nemění ani nerecyklují.** Zrušené pole dostane `reserved`. Hlídá to `buf breaking` proti `main` v `npm run check`.
- **Žádné verze `v` na drátě.** Klient posílá vždy aktuální verzi zprávy, vývoj řeší protobuf (nové pole, nová zpráva v `oneof`). Verze `v` a `upcast` zůstávají jen v logu na disku ([[Q101 Operace v kontraktu proto|Q101]]).
- Id jsou řetězce ve stejném tvaru jako v TS doméně (`FeatureId`, `BodyId` podle [[0015-artefakty-a-identita-telesa|ADR 0015]]). Jednotky mm a radiány ([[01-architektura#Souřadnice a jednotky]]).
- Dynamická data (parametry featur, entity skici) jsou `google.protobuf.Struct` / `ListValue`. Jejich tvar určuje [[Schéma featury|schéma featury]], ne `.proto`.

## Sezení

```proto
rpc OpenSession(OpenSessionRequest) returns (OpenSessionResponse);
// document_id, mesh_quality, read, resume_session_id
// → session_id, feature_types, read_model (session.writable), event_seq
rpc CloseSession(CloseSessionRequest) returns (CloseSessionResponse);   // idempotentní
```

- **Běhový dokument:** dokument je v paměti jádra nejvýš jednou. První `OpenSession` ho načte ze SQLite (snapshot + zbytek logu, [[05-persistence]]), poslední zavřené sezení ho uvolní.
- **Zámek pro zápis** ([[Q102 Sezení pro více karet|Q102]]): dostane ho sezení, které dokument otevřelo jako první a zámek je volný. Ostatní mají `writable = false` a každá změna skončí `READ_ONLY`. Sezení jen pro čtení zůstane jen pro čtení až do zavření (jako dnešní `doc-lock`).
- **Konec sezení:** `CloseSession`, nebo **timeout nečinnosti** (výchozí 10 min bez RPC a bez otevřeného `WatchSession`, `TINYCAD_SESSION_IDLE_SECONDS`; sezení uklízí vlákno serveru každých 30 s, [[Rozhodnutí nativního jádra|N59]]). Otevřená transakce se zahodí jako `Abort`, zámek se uvolní. Další volání se zaniklým `session_id` → `SESSION_NOT_FOUND` a klient otevře nové sezení.
- **Obnovení po reloadu karty** ([[Rozhodnutí nativního jádra|N56, N70]]): klient si `session_id` drží v `sessionStorage` a po reloadu ho pošle v `OpenSessionRequest.resume_session_id`. Je-li to živé sezení téhož dokumentu, server vrátí **totéž** sezení se zámkem; jinak (zaniklé, cizí) otevře nové, bez chyby. Při zavření karty klient pošle `CloseSession` s `keepalive`; karta, která spadne bez něj, drží zámek až do timeoutu nečinnosti.
- **Restart serveru** zahodí všechna sezení i otevřené transakce. Zapsané záznamy logu přežijí (SQLite). Klient dostane `SESSION_NOT_FOUND`, otevře sezení znovu a pokračuje. Rozpracovaná transakce je pryč, stejně jako dnes při pádu karty: `RemoteSession` vydá událost `lost`, dialog se zavře a uživatel to uvidí jako hlášení `notice.transactionLost` (toast, [[11-ui#Kompoziční kořen (app)|Hlášení v 11-ui]], [[M48-hlaseni-v-ui|M48]]). Výpadek, který opakování nepřekoná (`offline`), ukáže hlášení „Server je nedostupný“, návrat spojení ho odvolá.
- `feature_types` jsou všechny typy featur, které jádro zná ([[#Schéma featur]]). Klient je drží po dobu sezení.

## Změny dokumentu

Rozhraní kopíruje `OperationDispatcher`, `Transaction` a `UndoManager` ze [[04-operace-a-historie|spec 04]] ([[Q097 Transakce a undo přes RPC|Q097]]):

| RPC | Dnes | Záznam v logu | Chyby navíc |
|---|---|---|---|
| `Dispatch(op, label)` | `dispatcher.dispatch` | 1 | `TRANSACTION_OPEN` |
| `BeginTransaction(label)` | `dispatcher.begin` | – | `TRANSACTION_OPEN` |
| `Apply(op)` | `tx.apply` | – (při `Commit`) | `NO_TRANSACTION` |
| `ApplyTransient(op)` | `tx.applyTransient` | nikdy | `NO_TRANSACTION` |
| `Commit` | `tx.commit` | 0 nebo 1 | `NO_TRANSACTION` |
| `Abort` | `tx.abort` | – | `NO_TRANSACTION` |
| `Undo`, `Redo` | `undo.undo`, `undo.redo` | 1 | `NOTHING_TO_UNDO`, `NOTHING_TO_REDO`, `TRANSACTION_OPEN` |

Všechny vrací `ChangeResult { entry, read_model }`: zapsaný záznam (`LogEntryView`, u `Commit` prázdné transakce chybí) a read model **po regeneraci** ([[Q099 Read model po regeneraci|Q099]]).

Pravidla:

- **Jedna změna v letu na sezení.** Klient pošle další měnící požadavek až po odpovědi na předchozí. Server zpracovává požadavky sezení sériově. Proč: pořadí operací je pak dané a nemusí se řešit na serveru.
- **Tažení** (manipulátor, posuvník): klient si mezi odpověďmi pamatuje jen **poslední** hodnotu a pošle ji s dalším `Apply` (stejný vzor jako adaptér `GeometryService`). `setParams` se v transakci slučuje už při `apply` (spec 04), takže v transakci zůstane jeden krok.
- **Skica:** `Apply` s `feature.setParams` skici je potvrzení úpravy. Server skicu znovu vyřeší nativním planegcs **dřív, než operace vstoupí do dispečeru** (`SketchOperationSolver` v sezení, týká se `Dispatch`, `Apply` i `ApplyTransient`, `feature.add` skici a obojího uvnitř `batch`), a do dokumentu i do logu jde operace s **jeho** výsledkem. Přehrání logu, undo ani načtení proto řešič nepotřebují ([[Rozhodnutí nativního jádra|N47]]). Klient převezme souřadnice z read modelu vždy, bez prahu tolerance ([[Q097 Transakce a undo přes RPC|Q097]]). Když ji server nevyřeší, operace skončí `SKETCH_NOT_SOLVED`, dokument, transakce i log se nezmění a klient ponechá lokální skicu ([[Q103 Skica, kterou server nevyřeší|Q103]]): v jeho zrcadle dokumentu zůstane do dalšího přijatého `setParams` téže skici nebo do konce transakce; `Commit` zapíše poslední serverem přijatý stav ([[Rozhodnutí nativního jádra|N65]]).
- **Validace jen na serveru.** Neplatná operace → `INVALID_OPERATION` s `path` a dokument beze změny. Neplatné parametry featury nejsou chyba RPC: změna platí a featura je v read modelu červená (`FeatureError` `INVALID_PARAMS`), jako dnes.
- **Uloženo = odpověď.** `Dispatch`, `Commit`, `Undo` a `Redo` zapíšou záznam do SQLite v transakci databáze **před** odpovědí. Klient nepotřebuje stav „ukládá se“. Selhání zápisu → `STORAGE` a dokument v paměti se **znovu načte ze souboru** (ne inverze, [[Rozhodnutí nativního jádra|N35]]), takže log vždy odpovídá dokumentu. Otevřená transakce se tím zahodí: `Commit` zopakovaný po `STORAGE` skončí `NO_TRANSACTION` a klient to bere jako ztracenou transakci (obnoví read model a ukáže, že změna nebyla uložena).
- **Přejmenování dokumentu** je operace `document.rename` (`Dispatch`). `DocumentService.RenameDocument` otevřeného dokumentu jde přes jeho běhový dokument (druhý zapisovatel, serializovaný zámkem dokumentu; při otevřené transakci `DOCUMENT_OPEN`), zavřeného přímo do souboru ([[Rozhodnutí nativního jádra|N37]]). `DeleteDocument` otevřeného dokumentu skončí `DOCUMENT_OPEN`, jako dnes v prohlížeči ([[Rozhodnutí nativního jádra|N56]]).

### Idempotence

- `operation_id` je UUID od klienta, jedno na požadavek. Opakování po chybě sítě nebo `UNAVAILABLE` posílá **totéž** id.
- **Trvale** (SQLite, unikátní index na `operation_id` v tabulce `operations`): `Dispatch`, `Commit`, `Undo`, `Redo`, `CreateDocument`, `ImportDocument`, `RenameDocument`. Opakování vrátí uložený záznam a **aktuální** read model.
- **V paměti sezení** (posledních 64 odpovědí): `BeginTransaction`, `Apply`, `ApplyTransient`, `Abort`. Do logu nejdou, takže po restartu serveru zaniknou spolu s transakcí.
- Stejné `operation_id` s jiným obsahem požadavku → `OPERATION_ID_REUSED`. **Obsah** = otisk požadavku: SHA-256 jeho deterministické serializace bez `session_id`, `operation_id` a `read`, spočítaný z požadavku klienta, ne z operace po opětovném vyřešení skici ([[Rozhodnutí nativního jádra|N57]]). Opakování s jinými `known_meshes` nebo z nového sezení po restartu serveru je tedy tentýž požadavek.
- Opakovaný požadavek se nevykoná znovu a nevytvoří událost `changed`.

### Vlákna a zámky serveru

Z revize architektury po M44 ([[Rozhodnutí nativního jádra]] N106–N108):

- **Pořadí zámků:** manager sezení → dokument → události. **Pod zámkem manageru se nikdy nečeká na zámek dokumentu ani nespouští OCCT** (načtení dokumentu a první regenerace běží mimo něj: vloží se rezervace, dokument se dosadí po načtení; uvolnění pronájmu s `Abort` až po uvolnění zámku manageru).
- **Uvolnění běhového dokumentu výslovně zavře jeho kruhový buffer událostí**; `WatchSession` pak skončí `OK`. Při vypnutí serveru se nejdřív zavřou všechny buffery (`SessionManager::shutdown`), teprve potom `Server::Shutdown`.
- **Převod read modelu do `tinycad.v1` běží mimo zámek dokumentu** (vrstva rpc, viz výše): `RuntimeDocument` vrací doménový read model ze sdílených neměnných dat a služba ho převede až po návratu.
- Export STEP drží zámek celého procesu (globální stav `STEPControl_Writer`).
- **Idempotence před řešením skici:** pořadí v běhovém dokumentu je otisk → hledání uloženého záznamu (`PersistentDocument::lookup`) → teprve potom opětovné řešení skici a změna. Opakovaný požadavek se tak nikdy znovu neřeší.
- **Prázdný `Commit`** se do logu nezapíše, ale jeho `operation_id` si pamatuje sezení (`RecentResponses`), takže opakování vrátí úspěch, ne `NO_TRANSACTION`.
- **Otisk požadavku = SHA-256 z kanonického JSON** (operace přes převod spec 04, klíče seřazené), ne z bajtů protobufu: deterministická serializace protobufu je zaručená jen v rámci jednoho buildu a otisk je trvale v SQLite. Import (`ImportDocument` i `tinycad-import`) má otisk z obsahu souboru a stejný klíč `import:<sha>` (jedna funkce `importKey`).

## Read model a sítě

```proto
message ReadModelOptions {
  repeated string known_meshes = 1;   // content_version sítí, které klient drží
  string input_of = 2;                // featura editovaná v dialogu (ADR 0025)
}
message ReadModel { DocumentView document = 1; RegenView regen = 2; SessionView session = 3; }
```

- **Vždy celý** [[Read model|read model]], nikdy rozdíl. Klient předchozí nahradí. Je malý: featury s parametry, metadata těles, stavy featur, tělesa bez sítí, skici, roviny, osy, kotvy, `can_undo`, `can_redo`, transakce ([[Q099 Read model po regeneraci|Q099]]).
- **Sítě podle verze** ([[Q100 Verze sítí v mezipaměti klienta|Q100]]): každé `BodyView` nese `content_version`, neprůhledný řetězec `<ms startu procesu>-<čítač instancí Regeneratoru>.<handle tvaru>` ([[Rozhodnutí nativního jádra|N43]]). Mění se, kdykoli builder tělesu dá nový tvar (nový handle), těleso převzaté z cache regenerace ho drží, a je jedinečný napříč dokumenty otevřenými zároveň i přes restart serveru. Klient ho jen porovnává. Server tesseluje každou verzi jednou na kvalitu a drží sítě v mezipaměti běhového dokumentu ([[Rozhodnutí nativního jádra|N60]]). `mesh` je vyplněné, právě když verze není v `known_meshes`. Klient drží mezipaměť `content_version → síť` a zahodí verze, které v posledním read modelu nevidí. `content_version` nahrazuje dnešní identitu `ShapeHandle` v `SceneSync` ([[09-vykreslovani]]).
- **Kvalita tessellace** je pevná pro sezení (`OpenSessionRequest.mesh_quality`).
- **Vstup editované featury** ([[0025-vstupni-stav-editovane-featury|ADR 0025]]): s `input_of` read model nese `regen.input` (stav před featurou) se stejným pravidlem sítí. Bez něj `input` chybí. Odpovídá `RegenSnapshot.pick` z [[10-interakce]].
- **Jména ploch a hran** ([[08-topologicke-pojmenovani]]): `BodyView.face_names[i]` je primární jméno plochy s indexem `i` (`SubShapeIndex.index` od 0, [[Rozhodnutí nativního jádra|N91]]) (první ze seřazených jmen, `NameTable::nameOfFace`), `''` = bez jména. Klient z nich staví `TopoNames` pro picking. Plocha s více jmény (sloučené plochy) je pro klienta dohledatelná jen podle primárního jména. Stejně `BodyView.edge_names[i]` je jméno hrany s indexem `i` (`nameOfEdge`, hrana má nejvýš jedno jméno), `''` = bez jména.
- **Roviny ploch** (`BodyView.face_planes`, [[Rozhodnutí nativního jádra|N56]]): index plochy (jako u `face_names`) → rovina, jen rovinné plochy. Klient nemá jádro a skicu na ploše tělesa otevírá synchronně (`resolvePlane` skicáře, [[10-interakce]]).
- **Generace** (`RegenView.generation`) je čítač změn běhového dokumentu: +1 po každé úspěšné, neopakované změně (i `BeginTransaction` a `Abort`) a po znovunačtení po `STORAGE`. Není to počet běhů regenerace, ty se dějí při každém read modelu a cache je zlevní ([[Rozhodnutí nativního jádra|N55]]).
- **Sítě na drátě** (`Mesh`): ploché pole little-endian (`float32` pozice, normály a body hran, `uint32` indexy a rozsahy), stejně jako `MeshData` ze [[06-geometricke-jadro|spec 06]]. Dekódované `bytes` může začínat na posunu, který není násobkem 4; pak se před `new Float32Array(...)` zkopíruje (`slice()`).
- **Skici** (`SketchView`): rovina, vyřešené entity jako JSON ze [[12-skicar|spec 12]] včetně odvozených (zrcadlení, pole, písmena textu) a oblasti s obrysy (`Curve2`) pro vyplnění a picking ([[0028-geometrie-skici-v-jadre|ADR 0028]] bod 3).

**Pořadí read modelů v klientovi** ([[Rozhodnutí nativního jádra]] N136, po revizi M47): jediné pravidlo v `RemoteSessionImpl.publish` – zveřejní se read model jen ze současného sezení a s generací ne nižší než poslední zveřejněná (stejná projde); nové sezení (změna `session_id`, např. po restartu serveru) vodítko vynuluje a odpovědi nahrazeného sezení se zahodí. Zrcadlo i pohled berou jen zveřejněný read model; síť z read modelu se ověří (`validateMeshData`).

## Události: `WatchSession`

```proto
rpc WatchSession(WatchSessionRequest) returns (stream WatchSessionResponse);   // after_seq
// SessionEvent { seq; oneof { changed, regen_progress, resync, heartbeat } }
```

- Serverový stream, protože gRPC-Web klientský ani obousměrný stream neumí. Klient ho drží otevřený po celou dobu sezení. Otevřený stream zároveň brání timeoutu nečinnosti.
- `seq` událostí roste o 1 v rámci běhového dokumentu (není to `seq` logu, protože i `Apply` v transakci vytvoří novou generaci bez záznamu). Server drží posledních 256 událostí. Klient se po výpadku připojí s `after_seq` posledního přijatého; když server tak staré události nemá, pošle nejdřív `resync` a klient si vyžádá `GetReadModel`.
- `changed { generation, last_seq, by_session_id }`: existuje nová generace read modelu. Sezení, které změnu udělalo, ji už má v odpovědi a vlastní událost ignoruje (`by_session_id`). Ostatní (karta jen pro čtení) zavolají `GetReadModel`.
- `regen_progress`: stav featury během běžící regenerace (dnešní `featureDone`), jen pro ukazatel průběhu.
- `heartbeat` po 30 s ticha, aby proxy spojení nezavřela. Nespotřebuje `seq` (nese `seq` poslední odeslané události).
- `seq` začíná od 1 s každým načtením běhového dokumentu. Klient se `seq` jiné instance (budoucí `after_seq`) dostane `resync`, stejně jako s příliš starým.
- Uvolnění běhového dokumentu (poslední sezení odešlo) stream ukončí stavem OK; klient se znovu připojí a dostane `SESSION_NOT_FOUND`.

## Schéma featur

`FeatureTypeDescriptor` v `OpenSessionResponse.feature_types` je deklarativní část [[Schéma featury|schématu]] z C++ pluginu ([[Q098 Schéma featur v klientovi|Q098]]): `type`, `version`, `label` a `icon` (klíče), parametry v pořadí dialogu a výchozí parametry (`defaults`, klient je vloží do `feature.add`).

- `ParamDescriptor.spec` je `oneof` přes druhy dnešního `ParamSpec` (`length`, `angle`, `number`, `boolean`, `enumeration` pro `enum`, `point`, `data`, `bodies`, `topo`, `region`, `planes`, `axis`). Meze slouží jen poli v dialogu, rozhoduje server.
- **`VisibleWhen`** ([[Q105 Viditelnost parametru jako data|Q105]]): `{ param, equals_any | equals_none | less_than }` nad neověřenými parametry. Hodnota jiného typu, než test čeká, znamená „skryto“; chybějící parametr u `equals_none` znamená „viditelné“. Vyhodnocuje klient (dialog) i server (validace), jedna funkce na každé straně a společné testovací případy. Sdílené případy `schema.visibleWhen` ([[13-testovani#Sdílené testovací případy]]) při startu [[M38-zmrazeni-domeny|M38]] ukázaly, že TS predikáty `equals_none` (extrude `targets` a `distance`, revolve `targets`) hodnotu jiného typu ukazovaly. Opraveno v TS jako chyba (Pavel 2026-10-17).
- **`rules`** ([[M49-pravidla-validace-v-popisu|M49]], [[Rozhodnutí nativního jádra|N148, N149]]): vlastní pravidla typu nad rámec obecné kontroly jako data, `ParamRule { code, oneof rule { DisjointRefs disjoint_refs } }`, `DisjointRefs { param, other }` (sémantika v [[03-dokument#Vlastní pravidla]]). Klient je převede na `ParamRule` dokumentu a `validate` ze `featureSchemaOf` vrací obecnou kontrolu + `checkParamRules`, takže dialog ukáže u pole stejný kód jako server (`boolean.sameBody` s `{ index }`). Pravidlo **neznámého druhu** (prázdný `oneof` u klienta, který novou zprávu nezná) klient bez chyby vynechá – dopředná kompatibilita, server hlášení dál vrátí v read modelu. Většina typů má `rules` prázdné; pravidla, která daty popsat nejdou, v popisu nejsou ([[03-dokument#Pravidla jen na serveru]]).
- Klientská půlka [[Plugin featury|pluginu featury]] drží jen `tools`, `manipulators` a `messages` a páruje se s popisem podle `type`. Typ bez klientské půlky má dialog ze schématu a žádné nástroje navíc.

## `GeometryService`

Čtyři bezstavová volání přesně podle portu `SketchGeometry` ([[12-skicar]], [[Q096 Geometrie skici přes síť|Q096]]): `Intersections`, `Segment`, `Fillet`, `Offset`. Křivky `Curve2` (`line`, `arc`, `circle`, `bspline` s `id`) dovnitř, data ven, žádné `session_id`.

- Adaptér v klientovi drží **nejvýš jeden požadavek v letu na metodu**. Čekající volání se slučují („poslední vyhrává“, starší se vyřeší výsledkem posledního) **jen se stejným klíčem**: `Intersections` podle množiny id křivek, `Offset` podle id řetězce a `closed`. `Segment` a `Fillet` se neslučují, jen čekají ve frontě. Proč: nástroje (trim, split, zkosení, extend) volají port souběžně se svými argumenty a musí dostat výsledek svých argumentů ([[Rozhodnutí nativního jádra]] N6).
- Chyby: `KERNEL_INVALID_INPUT`, `KERNEL_OPERATION_FAILED`, `KERNEL_INTERNAL`. Adaptér je převede na odmítnutý `Promise` s `KernelErrorCode` jako dnes.

## Chyby

Kód gRPC říká, **co může klient udělat**, `ErrorDetail.reason` říká, **co se stalo** (tabulka v `errors.proto`). Text `Status.message` je jen technický, UI překládá `reason` a `issues` ([[0014-preklady-vue-i18n-a-klice|ADR 0014]]).

| Kód gRPC | Klient |
|---|---|
| `UNAVAILABLE`, `DEADLINE_EXCEEDED` | zopakuje se stejným `operation_id` (exponenciální čekání, nejvýš 5×), pak ukáže „Server není dostupný“ |
| `NOT_FOUND` (`SESSION_NOT_FOUND`) | otevře nové sezení a vyžádá read model |
| `NOT_FOUND` (`DOCUMENT_NOT_FOUND`) | zpět na seznam dokumentů |
| `FAILED_PRECONDITION` | neopakuje; obnoví read model (`UNKNOWN_TARGET`, `NOTHING_TO_UNDO`, `NO_TRANSACTION` po `STORAGE`) nebo ukáže chybu (`READ_ONLY`, `SKETCH_NOT_SOLVED`, `DOCUMENT_OPEN`) |
| `INVALID_ARGUMENT`, `INTERNAL` | chyba programu, neopakuje, technický text do konzole |

Chyby featur po regeneraci nejsou chyby RPC, jdou v `RegenView.statuses` (`FeatureError` s kódy ze [[07-regenerace#Stav featury|spec 07]]).

## Testy

- **Kontrakt:** `buf lint` a `buf breaking` proti `main` v `npm run check` (krok `check:proto`).
- **Převody:** každá zpráva `Operation` ↔ JSON operace spec 04 tam a zpět (C++), `ParamDescriptor` ↔ `ParamSpec` (TS), `Mesh` ↔ `MeshData` včetně posunu, který není násobkem 4 (TS).
- **`VisibleWhen`:** sedm dnešních predikátů jako sdílené případy, stejný výsledek v C++ a v TS, včetně chybějícího parametru a hodnoty jiného typu.
- **Pravidla (M49):** `describeRule` (boolean má `disjoint_refs { param: "tools", other: "targets" }`, ostatní typy `rules` prázdné), zlatý soubor `test/golden/feature-types.json` s pravidlem; v TS `featureSchemaOf` s pravidlem (kód a `{ index }`) a s pravidlem neznámého druhu (i binárně s neznámým polem `oneof`) → ignorováno; sdílené případy `schema.validate` v C++ i v TS.
- **Sezení** (C++ integrační přes skutečný gRPC kanál): otevření, druhé sezení `writable = false` a `READ_ONLY`, timeout zahodí transakci a uvolní zámek, `SESSION_NOT_FOUND` po zavření, `resume_session_id` vrátí totéž sezení se zámkem, smazání otevřeného dokumentu `DOCUMENT_OPEN`.
- **Idempotence:** dvakrát `Commit` se stejným id = jeden záznam; dvakrát `Apply` = jedno použití; stejné id s jinou operací = `OPERATION_ID_REUSED`; `Commit` zopakovaný po restartu serveru najde záznam v SQLite.
- **Transakce a undo přes RPC:** dnešní testy spec 04 (50 změn = 1 záznam, abort, přechodné kroky, undo po znovuotevření) projdou proti `SessionService`.
- **Sítě:** první read model nese všechny sítě; `known_meshes` se všemi verzemi → žádná síť; změna parametru jednoho tělesa → síť jen u něj; restart serveru → nové verze, klient sítě stáhne znovu.
- **Stream:** připojení s `after_seq` dostane chybějící události; příliš staré `after_seq` → `resync`; `changed` přijde do sezení jen pro čtení.
- **E2E** (Docker Compose, Playwright): dnešní sada e2e projde proti serveru, plus test s uměle zpožděnou sítí (150 ms) a s výpadkem spojení během tažení.

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
