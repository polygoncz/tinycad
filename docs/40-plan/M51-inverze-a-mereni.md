---
type: milestone
status: done
order: 51
aliases:
  - M51
  - M51 Inverze po chybě zápisu a měření výkonu
modules:
  - server
specs:
  - "[[05-persistence]]"
  - "[[04-operace-a-historie]]"
  - "[[14-protokol]]"
  - "[[13-testovani]]"
depends_on:
  - "[[M50-occt2d-a-vrstva-rpc]]"
started: 2026-10-17
finished: 2026-10-17
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M51 – Inverze po chybě zápisu a měření výkonu

**Cíl:** Po chybě zápisu do SQLite se dokument v paměti vrátí inverzí, log ani zásobníky undo se nedotknou a otevřená transakce přežije (N35); regenerace v C++ má měření výkonu, které vypisuje časy a ověřuje jen deterministické veličiny (N142).

> Upřesněno 2026-10-17 (plánovač, [[Rozhodnutí nativního jádra#Plány M48–M51 (po nativním jádře)|N155, N156]]). Stopa A po [[M50-occt2d-a-vrstva-rpc|M50]] (stejné soubory sezení, proto ne souběžně).

**Specifikace:** [[05-persistence]], [[04-operace-a-historie]] (dispečer, transakce), [[14-protokol#Změny dokumentu]], [[13-testovani#Měření výkonu]]

**Navazuje na:** [[M50-occt2d-a-vrstva-rpc]]

## Návrh: zápis před logem (N155)

Dnes dispečer **nejdřív** přidá záznam do logu v paměti (a undo si posune zásobníky) a `PersistentDocument` ho **potom** zapíše do SQLite. Když zápis selže, v paměti už je záznam, který na disku není – a log je append-only, takže ho nejde vzít zpět. Proto N35 dnes celý dokument znovu načte ze souboru (a zahodí otevřenou transakci).

Inverze bez porušení append-only jde jen tak, že se **pořadí otočí**: dispečer záznam sestaví, nechá ho zapsat portem `EntryWriter` a do logu ho přidá, až když zápis prošel (write-ahead). Když zápis selže, log ani zásobníky undo se nezměnily a stačí vrátit dokument:

| Volání | Co je v paměti, když zápis selže | Co se udělá | Výsledek |
|---|---|---|---|
| `dispatch` (i undo a redo – jdou přes `dispatch`) | operace je aplikovaná | dispečer aplikuje `entry.inverse` | dokument jako před voláním, log a zásobníky beze změny, `STORAGE` |
| `commit` | kroky transakce aplikované, přechodné kroky už vrácené | **nic** se nevrací: transakce zůstane otevřená se svými kroky, přechodné kroky zaniknou (byly vrácené a nikdy se nelogují) | `STORAGE`, `inTransaction()` = true, opakovaný `Commit` (nový `operation_id` nebo stejný) zapíše |
| inverze sama selže (chyba handleru = bug) | dokument v neznámém stavu | záloha: dnešní znovunačtení ze souboru (N35) | `STORAGE` s `reloaded = true`, transakce zahozená; selže-li i načtení → `broken` |

Proč je inverze křehčí než znovunačtení: spoléhá na to, že inverze handleru přesně vrátí operaci (to hlídají testy handlerů a vlastnostní test přehrání), kdežto znovunačtení dá vždy stav shodný s diskem. Proto zůstává jako záloha.

## Úkoly

- [x] 1. Port `EntryWriter` v dispečeru: zápis před přidáním do logu, inverze při selhání; commit transakce při selhání nechá transakci otevřenou.
- [x] 2. `PersistentDocument` nad portem: `STORAGE` bez znovunačtení, záloha při selhání inverze, `ChangeError::reloaded`; `RuntimeDocument` zvýší generaci jen po znovunačtení.
- [x] 3. Testy s `FailingFile` a gRPC: zápis selže uprostřed transakce, `Commit` vrátí `STORAGE`, transakce zůstane otevřená, opakování uspěje.
- [x] 4. Měření výkonu regenerace v C++ (deska s 36 děrami a 4 zaobleními) jako test, který jen vypisuje; kontroly počtu volání jádra a živých handle, každá ověřená úmyslnou chybou.
- [x] 5. Spec 04, 05, 13, 14, čísla měření do vaultu a deník (hlavní sezení).

## Akceptační kritéria

- Chyba zápisu nezahodí transakci ani nezmění log; log v paměti vždy odpovídá souboru (test „log v paměti = soubor“ po každém selhání).
- Klient po `STORAGE` u `Commit` dostane při opakování úspěch, ne `NO_TRANSACTION` (spec 14 upravená).
- Měření běží v `check:server`, vypisuje časy a na čase nikdy nepadá; každá jeho kontrola má v hlášení úmyslnou chybu, která ji shodila.
- `npm run check:full` zelený.

## Co se naučíš

Proč je inverze křehčí než znovunačtení a jak ji udělat bezpečně (write-ahead: nejdřív trvalý zápis, pak stav v paměti); měření, které nemůže selhat, v C++ ([[Měření, které nemůže selhat]]).

## Implementační plán

Úkoly 1–4 = jedno spuštění subagenta `implementer` (Opus), v pořadí 1 → 4. Úkol 5 dělá hlavní sezení. Pro všechny: OOP a KISS (N9), build v Dockeru `-j3` (N116), cílené testy `tinycad_ops_tests`, `tinycad_storage_tests`, `tinycad_session_tests`, `tinycad_rpc_tests`, `tinycad_regen_tests`; celý `npm run check:full` na konci úkolů 3 a 4 (N2).

### 1. `EntryWriter` v dispečeru (`ops`)

- **Soubory:** `server/src/ops/include/tinycad/ops/dispatcher.hpp`, `server/src/ops/dispatcher.cpp`, `server/src/ops/include/tinycad/ops/transaction.hpp`, `server/src/ops/transaction.cpp`, `server/src/ops/undo.cpp` jen když potřebuje; testy `server/test/ops/{dispatcher_test, transaction_test, undo_test}.cpp`, `server/test/ops/testing.hpp` (falešný zapisovač).
- **Kontrakt:**

```cpp
// dispatcher.hpp
/** Trvalý zápis záznamu PŘED tím, než ho dispečer přidá do logu (write-ahead, N155). */
class EntryWriter {
 public:
  virtual ~EntryWriter() = default;
  /** entry.seq = log.lastSeq() + 1. Chyba = technický text; dispečer pak nic nepřidá. */
  virtual core::Result<void, std::string> write(const LogEntry& entry) = 0;
};

/** Selhání zápisu přes EntryWriter. */
struct WriteFailed {
  std::string message;
  /** false = inverze selhala a dokument je v neznámém stavu (volající ho musí znovu načíst). */
  bool reverted = true;
};

class OperationDispatcher {
  …
  /** Jediný zapisovač; nullptr = bez trvalého zápisu (testy, sdílené případy). Výměna → AssertionError. */
  void setWriter(EntryWriter* writer);
  /**
   * Dnešní chování + : po úspěšné aplikaci sestaví záznam, zapíše ho writerem a teprve pak
   * přidá do logu a řekne posluchači. Zápis selže → aplikuje entry.inverse, log a posluchač
   * nedotčené, vrátí WriteFailed.
   */
  core::Result<LogEntry, DispatchError> dispatch(const Operation& op, const DispatchMeta& meta = {});
};
```

  - `DispatchError` = malá třída nebo struktura s `kind` (`Invalid` s `OperationLoadError`, `WriteFailed` s `WriteFailed`) – ne `std::variant` s visitorem (N9). Implementátor zvolí tvar, který se nejlíp čte ve volajících, a popíše ho v hlášení.
  - `UndoManager::undo/redo` vrací stejný typ chyby; zásobníky se mění jen v `onAppended` (už dnes), takže při selhání zápisu zůstanou.
  - `Transaction::commit()` → `core::Result<std::optional<LogEntry>, WriteFailed>`: vrátí přechodné kroky (jako dnes), sestaví záznam, zapíše; při selhání **neukončí** transakci (`ended()` = false), přechodné kroky z `steps_` vyřadí (už jsou vrácené), ostatní kroky zůstanou aplikované. Prázdná transakce = úspěch bez zápisu (writer se nevolá).
  - `abort()` beze změny (nic nezapisuje).
- **Krajní případy:** inverze při `dispatch` selže (`applyGuarded` vrátí chybu) → `WriteFailed { reverted = false }`, nic dalšího se nezkouší; writer nesmí volat dispečer (reentrance → AssertionError jako dnes).
- **Testy:** falešný writer, který selže na N-tém zápisu: dispatch → dokument stejný (`studio()` ukazatel jako před voláním nemusí být stejný, obsah ano), log beze změny, posluchač nevolán; undo/redo → zásobníky beze změny; commit → transakce otevřená, kroky aplikované, přechodné vrácené, další `commit` se stejným writerem (už funkčním) zapíše jeden záznam; inverze, která selže (handler testu, jehož inverze vrátí chybu) → `reverted = false`; bez writeru se chování nemění (všechny dnešní testy `ops` beze změny zelené).
- **Hotovo když:** `tinycad_ops_tests` a sdílené případy `ops` zelené.

### 2. `PersistentDocument` a `RuntimeDocument`

- **Soubory:** `server/src/storage/include/tinycad/storage/persistent_document.hpp`, `server/src/storage/src/persistent_document.cpp`, `server/src/session/src/runtime_document.cpp` (a hlavička, je-li v ní komentář k N35); testy `server/test/storage/persistent_document_test.cpp`, `idempotence_test.cpp`.
- **Kontrakt:**
  - `Impl` implementuje `ops::EntryWriter`; `write` zapíše `StoredEntry{entry.seq, currentKey, logEntryJson(entry)}` přes `DocumentFile::appendEntries`. `currentKey` nastaví volání `dispatch`/`commit`/`undo`/`redo` těsně před voláním dispečeru (KISS: jeden člen `std::optional<OperationKey>`, po volání se vynuluje).
  - Snapshot po každém 100. záznamu zůstává **po** úspěšném přidání do logu (dokument už obsahuje záznam).
  - `ChangeError` dostane `bool reloaded = false`: true jen když se po `WriteFailed{reverted = false}` dokument znovu načetl (záloha N35). `broken()` beze změny (selhalo i načtení).
  - `STORAGE` s `reloaded = false`: dokument, log, zásobníky, transakce jako před voláním (u commitu transakce otevřená bez přechodných kroků).
  - `RuntimeDocument`: generace + 1 a událost `changed` po `STORAGE` jen při `reloaded = true` (dnes po každém `STORAGE` nerozbitého dokumentu). Komentář u změnových metod v `runtime_document.hpp` upravit.
  - Komentáře hlavičky `persistent_document.hpp` (pravidla, odstavec o znovunačtení) přepsat na N155.
- **Testy (`persistent_document_test.cpp`, úprava dnešních tří testů znovunačtení):** `AFailedWriteIsStorageAndTheDocumentIsRevertedByTheInverse` (log i dokument jako před voláním, `broken()` false, další dispatch uspěje se seq o jedna vyšším než poslední uložený); `AFailedCommitKeepsTheTransactionOpen` (po `STORAGE` `inTransaction()`, kroky v dokumentu, opakovaný `commit` uloží jeden záznam s oběma kroky); `AFailedUndoKeepsTheStacks` (`canUndo()` stejné, opakování uspěje); `WhenTheInverseFailsTheDocumentIsReloaded` (handler testu s rozbitou inverzí → `reloaded`, transakce pryč); `WhenTheReloadFailsTooTheDocumentIsBroken` (beze změny smyslu); `TheLogInMemoryMatchesTheFile` po každém z těchto selhání.
- **Hotovo když:** `tinycad_storage_tests` a `tinycad_session_tests` zelené.

### 3. Testy přes sezení a gRPC

- **Soubory:** `server/test/session/runtime_document_transactions_test.cpp`, `server/test/rpc/grpc_transactions_test.cpp` (po M50), případně `runtime_testing.hpp` (katalog s `FailingCatalog`).
- **Scénáře:** (a) `BeginTransaction`, dvakrát `Apply`, zápis selže → `Commit` = `STORAGE`, `read_model.session.transaction` dál nastavená, generace beze změny; vypnout selhání → `Commit` (nový `operation_id`) uspěje a log má jeden záznam; (b) `Dispatch` selže → read model po chybě stejný jako před ní, žádná událost `changed`; (c) opakovaný `Dispatch` se stejným `operation_id` po selhání = nový pokus (nic není uložené, takže to není opakování) a uspěje.
- **Hotovo když:** testy zelené; `rg -n "N35" server/src` najde jen komentáře popisující N155.

### 4. Měření výkonu regenerace (N142)

- **Soubory:** nový `server/test/regen/regeneration_measure_test.cpp`, `server/test/regen/CMakeLists.txt` (linkuje `tinycad_kernel`, `tinycad_feature_builders`, `tinycad_features`, `tinycad_test_support` pro `loadCase`); případně počítací dekorátor jádra do `server/test/regen/testing.hpp` (nejdřív hledat existující dekorátor v `server/test/session/runtime_testing.hpp` a `server/test/kernel/kernel_test_support.hpp`, N45).
- **Kontrakt (podle spec 13 „Měření výkonu“, dřív TS M15):**
  - Model: dokument ze sdíleného případu `test/shared-cases/regen/boolean-plate-36-holes-fillet.json` (`loadCase("regen", …)`, `document::fromData`) – žádná druhá kopie modelu.
  - Měří (každé 3×, vypíše medián v ms tabulkou na `std::cout`): (1) první regenerace nového `Regenerator` nad novým `OcctKernel`, (2) tessellace těles výsledku (`MeshQuality{0.1, 0.5}`, výchozí kvalita sezení), (3) plný přepočet po změně první featury (rozměr desky), (4) přepočet z cache po změně poslední featury (poloměr zaoblení). Hodiny `std::chrono::steady_clock`.
  - **Nikdy nepadá na čase.** Ověřuje jen deterministické veličiny: žádná featura v chybě, jedno těleso, 46 ploch (jako `expected` případu); počty volání jádra při přepočtu z cache (počítací dekorátor `ModelingKernel`: 0× `makeCylinder` a 0× `boolean`, ≥ 1× zaoblení – přesná čísla zjistí implementátor během prvního běhu a zapíše je jako konstanty s komentářem); `liveHandleCount()` po zničení `Regenerator` = 0 a během života = handle stavu.
  - **Každá kontrola má vlastní úmyslnou chybu** (dočasně, nezapsat do kódu): cache vypnutá (změna první featury místo poslední v kroku 4) → padne kontrola počtu volání; vynechaný `release` handle v testu (držet `ShapeHandle` navíc) → padne `liveHandleCount`; přepnutý operátor booleanu → padne počet ploch. Výsledky do hlášení (tabulka kontrola → chyba → spadla ano/ne).
  - Test běží v `check:server` (ctest) jako ostatní; jméno sady `RegenerationMeasure`.
- **Hotovo když:** test zelený, výpis časů v hlášení (hlavní sezení je zapíše do spec 13 vedle čísel z M15), tabulka úmyslných chyb v hlášení.

### 5. Specifikace a čísla (hlavní sezení)

- [[05-persistence]]: selhání zápisu = inverze (N155), záloha znovunačtení; seznam testů.
- [[04-operace-a-historie]]: `EntryWriter` (zápis před logem), commit transakce při selhání zápisu.
- [[14-protokol#Změny dokumentu]]: `STORAGE` u `Commit` nechá transakci otevřenou; klient ji nemusí brát jako ztracenou.
- [[13-testovani#Měření výkonu]]: C++ měření a čísla.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_Návrh Clauda (stopa A)._

- Zápis před logem: dispečer dostal port `EntryWriter`, záznam jde do SQLite dřív než do logu v paměti. Chyba zápisu u `dispatch`/`undo`/`redo` vrátí dokument inverzí, `commit` nechá transakci otevřenou (opakování uspěje); selže-li inverze, záloha je znovunačtení (N35 podle Pavla).
- Měření regenerace v C++ (deska s 36 děrami): první regenerace 52–58 ms, plný přepočet 53–72 ms, přepočet z cache 12–17 ms se třemi voláními jádra – asi 2× rychlejší než WASM v M15. Každá kontrola měření ověřená úmyslnou chybou.
- E2E restartu jádra z M48 se ukázalo nestabilní (503 na `WatchSession` během restartu v konzoli) – oprava v M52. Docker Desktop se během posledního kroku vypnul, spuštěn znovu.
- `check:server` 1786, `check` 5857 / 332.
