---
type: milestone
status: done
order: 15
aliases:
  - M15
  - M15 Export a dokončení
modules:
  - kernel
  - kernel-occt
  - persistence
  - document
  - ops
  - interaction
  - render
  - app
  - ui
specs:
  - "[[06-geometricke-jadro]]"
  - "[[05-persistence]]"
  - "[[04-operace-a-historie]]"
  - "[[03-dokument]]"
  - "[[09-vykreslovani]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
  - "[[13-testovani]]"
depends_on:
  - "[[M14-topologicke-pojmenovani]]"
started: 2026-10-14
finished: 2026-10-14
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-14
---
# M15 – Export a dokončení

**Cíl:** dostat model ven a uzavřít první verzi. Export viditelných těles do STEP, export a import dokumentu `.tinycad.json` i s historií úprav, panel historie (log), barva těles, měření výkonu na větším modelu a úklid všech otevřených otázek.

**Specifikace:** [[06-geometricke-jadro|06]] (`ExchangeOps.exportStep`, STEP v adaptéru), [[05-persistence|05]] (soubor verze 2 s historií, `exportStoredDocument`, import historie), [[04-operace-a-historie|04]] (`body.setColor`, log pro panel historie), [[03-dokument|03]] (`BodyMeta.color`), [[09-vykreslovani|09]] (`setBodyColor`), [[10-interakce|10]] (`HistoryModel`, `createFileActions`, barva v `BrowserModel`), [[11-ui|11]] (port `download`, exportér, import, panel historie, menu Soubor, barva v Prohlížeči), [[13-testovani|13]] (měření výkonu, e2e stažení)

**Rozhodnutí** (noční rychloakce, bez Pavla): R121–R135 v [[Rozhodnutí noční rychloakce#M15 – Export a dokončení]], [[Q036 Export dokumentu s historií|Q036]] (doplnění M15), [[Q073 Průhlednost a barva těles|Q073]], [[Q007 Cache geometrie|Q007]] a úklid otázek ([[Q001 Jedno nebo více Part Studií|Q001]], [[Q003 Proměnné a výrazy v parametrech|Q003]], [[Q004 Popis a barva featury|Q004]], [[Q006 Větvení operačního logu|Q006]], [[Q011 Více workerů jádra|Q011]], [[Q013 Graf závislostí featur|Q013]]).

**Navazuje na:** [[M14-topologicke-pojmenovani]] – plán začíná **po sloučení M14** (historie a topologie jádra, `NameTable`, Fillet a Chamfer, `createInThreadOcctKernel` v `kernel-occt/testing.ts`, `BrowserModel.hidden`, `RegenSnapshot.bodies`).

## Úkoly

- [x] Ú1 `kernel`, `kernel-occt`: `ExchangeOps.exportStep`, STEP přes `oc.FS`, zpětné načtení v testu
- [x] Ú2 `persistence`: soubor `.tinycad.json` verze 2 s historií, `exportStoredDocument`, import historie
- [x] Ú3 `interaction`: `HistoryModel` (panel historie) a `createFileActions` (akce exportu, port `FileExporter`)
- [x] Ú4 `document`, `ops`: `BodyMeta.color`, operace `body.setColor`
- [x] Ú5 `render`: `setBodyColor`
- [x] Ú6 `tests`: měření regenerace a tessellace na větším modelu
- [x] Ú7 `interaction`: barva tělesa v `BrowserModel`
- [x] Ú8 `app`: exportér (STEP, dokument), port `download`, `importDocumentFile`, historie, barvy do viewportu
- [x] Ú9 `ui`: menu Soubor, stažení, import v seznamu dokumentů, panel historie, barva v Prohlížeči, překlady
- [x] Ú10 `e2e`: stažení STEP, export a import dokumentu s historií, panel historie
- [x] Ú11 hlavní sezení: kontrola, výsledky měření do Q007, vault, `architecture-reviewer`, retrospektiva první verze

## Akceptační kritéria

- **STEP jde načíst zpět:** kvádr 20 × 20 × 10 minus válec r = 3, který jím prochází → `exportStep` → `STEPControl_Reader` v testu OCCT v Node vrátí právě jeden solid se stejným objemem (`4000 − 90π`, relativně 1e-4) a stejným bounding boxem (1e-5); dvě tělesa → dva solidy (Ú1, běží v `npm run check`).
- **E2E stažení STEP:** kvádr → menu Soubor → „Exportovat STEP“ → stažený soubor `<jméno dokumentu>.step` začíná `ISO-10303-21;` (Ú10).
- **E2E export a import dokumentu:** kvádr a válec → „Exportovat dokument“ → v seznamu dokumentů „Importovat“ se staženým souborem → otevře se nový dokument se stejnými featurami v Timeline a „Zpět“ odebere poslední featuru (historie se přenesla) (Ú10).
- **Import ověří historii:** soubor, jehož historie po přehrání nedá uložený stav, se odmítne čitelnou chybou a nic se neuloží; soubor verze 1 (M4) se dál načte (Ú2).
- **Panel historie** ukazuje záznamy logu nejnovější nahoře, včetně „Zpět: …“ a „Znovu: …“, a vrácené záznamy odliší (Ú3, Ú9, Ú10).
- **Barva tělesa** se nastaví v Prohlížeči, jde přes undo a přežije reload (Ú4, Ú7, Ú8; e2e ověří hodnotu v Prohlížeči po reloadu).
- **Měření výkonu** vypíše časy regenerace a tessellace modelu se ~40 featurami a nikdy nepadá na čase; ověřuje cache počtem volání jádra a úklid handle (Ú6). Výsledky jsou zapsané v [[Q007 Cache geometrie|Q007]] (Ú11).
- Žádná otázka ve vaultu nezůstane `open` (úklid hotový při plánování, Ú11 jen zkontroluje nové).
- `npm run check`, `npm run test:integration`, `npm run build`, `npm run test:e2e` zelené.

## Úkoly z M14

Odloženo z [[M14-topologicke-pojmenovani|M14]] (rozhodnutí v [[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|M14 – Topologické pojmenování]]). Rozhodnuto při upřesnění M15 ([[Rozhodnutí noční rychloakce#M15 – Export a dokončení|R132, R133]]): **nic z toho se v M15 nedělá**, všechno je v „Další nápady“.

- [ ] **Boolean s více výslednými tělesy** ([[07-regenerace#Builder featury]], R8 → R100 → R132 ⚠) → Další nápady.
- [ ] **Automatické cíle vysunutí** (R66, R109 → R133 ⚠) → Další nápady.
- [ ] **Obecné „Po plochu“** (R109 → R133 ⚠) → Další nápady.
- [ ] **Vrcholy** (R101 → R133 ⚠) → Další nápady.
- [ ] **Čipy referencí `topo`** (R103 → R133 ⚠) → Další nápady.
- [ ] **Zkosení dvěma vzdálenostmi, zaoblení s proměnným poloměrem** (R105 → R133 ⚠) → Další nápady.

## Mimo rozsah M15

- Barvy a jména těles ve STEP (XCAF), import STEP do modelu, jiné formáty (STL, IGES) – R123 ⚠.
- Výběr těles k exportu (exportují se všechna viditelná, R122 ⚠), export bez historie z UI (R125 ⚠).
- Návrat k záznamu z panelu historie (to by bylo větvení logu, [[Q006 Větvení operačního logu|Q006]]) – R127 ⚠.
- Průhlednost těles ([[Q073 Průhlednost a barva těles|Q073]], R129 ⚠), persistentní cache geometrie ([[Q007 Cache geometrie|Q007]], R131 ⚠).

## Implementační plán

Každý úkol dělá zvlášť subagent `implementer` (TDD: test nejdřív a ověřit, že padá; `npm run check`). Kontrakty jsou propsané do specifikací (odkazy u úkolů). Implementátor hlásí odchylky, hlavní sezení je propíše. Seznam souborů je vodítko: sáhnout jinam smí, když to dává smysl, a ohlásí to.

**Paralelní běh:** úkoly jedné vlny mají oddělené soubory a běží souběžně ve vlastních worktree. `index.ts` a `testing.ts` modulu, `src/kernel/kernel.ts`, `src/kernel/fake-kernel.ts`, `src/kernel-occt/occt-kernel-impl.ts`, `src/persistence/file.ts`, `src/document/model.ts`, `src/ops/operation.ts`, `src/interaction/browser-model.ts`, `src/render/viewport.ts`, `.dependency-cruiser.cjs`, `tsconfig*.json`, `package.json`, `src/ui/i18n/{cs,en}.ts`, `src/app/session.ts`, `src/app/browser.ts`, `src/app/testing.ts` a `src/app/index.ts` smí v dané vlně měnit jen úkol, u kterého jsou uvedené.

**Nové závislosti npm:** žádné. Předpřipravený build má vše potřebné (ověřeno v `replicad_single.d.ts`, R1): `STEPControl_Writer` (`Transfer(shape, STEPControl_StepModelType, compgraph, Message_ProgressRange)`, `Write(path)` → `IFSelect_ReturnStatus`), `STEPControl_Reader` (`ReadFile`, `TransferRoots`, `OneShape`), `TopoDS_Builder.MakeCompound/Add` (build váže `TopoDS_Builder`, ne `BRep_Builder` – opraveno po Ú1), `TopoDS_Compound`, `BRepGProp.VolumeProperties` + `GProp_GProps`, Emscripten `oc.FS` (`writeFile`, `readFile`, `unlink`). Ikony `ti-file-export`, `ti-file-import`, `ti-history`, `ti-palette` jsou v `@tabler/icons-webfont` (ověřeno). Tabulka modulů v `.dependency-cruiser.cjs` a ve [[01-architektura|spec 01]] se nemění.

| Vlna | Úkoly (paralelně) | Závisí na |
|---|---|---|
| A | Ú1 STEP · Ú2 soubor s historií · Ú3 historie a akce exportu · Ú4 barva v dokumentu · Ú5 barva v `render` · Ú6 měření výkonu | M14 |
| B | Ú7 barva v `BrowserModel` | Ú3 (`interaction/index.ts`), Ú4 |
| C | Ú8 `app` | Ú1, Ú2, Ú3, Ú5, Ú7 |
| D | Ú9 `ui` | Ú8 |
| E | Ú10 e2e | Ú9 |
| F | Ú11 hlavní sezení | E, Ú6 |

Proč takhle: vlna A jsou nezávislé kusy v různých modulech (jádro, persistence, prezentační modely, doménová data, render, měření nad hotovým M14). Barva v `BrowserModel` potřebuje zároveň `BodyMeta.color` (Ú4) a `interaction/index.ts`, který ve vlně A mění Ú3, proto samostatná malá vlna B. `app` je jediné místo, kde se vše potkává, a `ui` potřebuje hotové `AppSession`.

### Vlna A

#### Ú1 `kernel`, `kernel-occt`: export STEP
- **Soubory:** `src/kernel/kernel.ts` (`ExchangeOps`, `GeometryKernel` += `ExchangeOps`), `fake-kernel.ts` (pseudo-STEP), `testing.ts` (kontraktová sada M15), `index.ts` + testy; `src/kernel-occt/step.ts` (nový: `writeStep`), `occt-kernel-impl.ts`, `worker-impl.ts` (předání bajtů přes `transfer`), `client.ts`, `index.ts` (`createOcctKernel` přeposílá `exportStep`) + testy `occt-step.test.ts` (nový), `worker-impl.test.ts`, `client.test.ts`; ručně psané implementace `GeometryKernel` v testech jiných modulů jen doplnit o delegaci (ohlásit). `regen` (`ModelingKernel`) **nemění** – buildery exportovat nesmí.
- **Kontrakt** ([[06-geometricke-jadro#Stav po M15]], [[06-geometricke-jadro#Kontrakt (platí pro každou implementaci)]], [[06-geometricke-jadro#Export STEP v adaptéru (M15)]], [[06-geometricke-jadro#`FakeKernel`]]):
  ```ts
  export interface ExchangeOps {
    /** Soubor STEP (AP214, mm) se všemi tvary shapes; bajty v UTF-8/ASCII. */
    exportStep(shapes: readonly ShapeHandle[]): Promise<Uint8Array<ArrayBuffer>>;
  }
  export interface GeometryKernel extends PrimitiveOps, TransformOps, BooleanOps, SketchOps, SweepOps, DressupOps, ExchangeOps, MeshOps, QueryOps, LifecycleOps {}
  ```
  - `shapes` neprázdné a bez duplicit, jinak `'invalid-input'`; neznámý handle → `'unknown-handle'`; selhání `Transfer`/`Write` (status jiný než `IFSelect_RetDone`) → `'operation-failed'`. Vstupy zůstávají platné, žádný nový handle. Výsledek je nový buffer (celý, vlastní `ArrayBuffer`), text po oříznutí začíná `ISO-10303-21;` a končí `END-ISO-10303-21;`.
  - OCCT: jeden tvar přímo, víc → `TopoDS_Compound` přes `TopoDS_Builder` (`BRep_Builder` build neváže, opraveno po Ú1); `STEPControl_Writer.Transfer(tvar, STEPControl_AsIs, true, new Message_ProgressRange())`, `Write('/tmp/tinycad-export-<n>.step')` (`n` rostoucí čítač), `oc.FS.readFile` → kopie do nového `Uint8Array`, `oc.FS.unlink` ve `finally` (i po chybě); objekty OCCT přes `using`. Obsah hlavičky (čas, jméno) se nezaručuje.
  - Fake: deterministický text `ISO-10303-21;` / `HEADER;` … / `DATA;` / řádek `#<i>=FAKE_SOLID((min),(max));` na každý tvar v pořadí `shapes` (AABB) / `ENDSEC;` / `END-ISO-10303-21;`, kódovaný `TextEncoder`.
- **Testy:** kontraktová sada (obě jádra): kvádr → začátek a konec textu, neprázdný; dva kvádry; `[]`, duplicitní handle → `'invalid-input'`; neznámý a uvolněný handle → `'unknown-handle'`; vstup zůstane platný a `liveHandleCount` se nezmění; dvě volání vrací různé buffery. OCCT navíc (`occt-step.test.ts`): **akceptační** kvádr 20 × 20 × 10 minus válec r = 3 přes celou výšku → zapsat bajty do `oc.FS`, `STEPControl_Reader.ReadFile` = `IFSelect_RetDone`, `TransferRoots` ≥ 1, `OneShape` má právě 1 solid, objem `BRepGProp.VolumeProperties` = `4000 − 90π` (relativně 1e-4), bbox jako originál (1e-5); dva oddělené kvádry → 2 solidy a součet objemů; dočasný soubor po exportu v `oc.FS` není (i po chybě – vynucená přes neplatný vstup do `Transfer`, pokud jde, jinak ohlásit). Klient a worker přeposílají `exportStep` a worker předá buffer přes `transfer`.
- **Ověřit a ohlásit:** jednotky v souboru (`mm`, výchozí `write.step.unit`); čas exportu kvádru s dírou v Node.
- **Hotovo když:** testy a `npm run check` projdou; `createOcctKernel` přeposílá `exportStep`.

#### Ú2 `persistence`: soubor s historií
- **Soubory:** `src/persistence/file.ts`, `load.ts` (sdílené pomocníky: parsování záznamů a základního snapshotu, porovnání stavů – jen vytáhnout, chování `loadDocument` se nemění), `index.ts` + testy `file.test.ts`, `index.test.ts`.
- **Kontrakt** ([[05-persistence#Export a import souboru]]):
  ```ts
  export interface TinycadFile {
    readonly format: 'tinycad.file';
    readonly formatVersion: 2;
    readonly snapshot: DocumentSnapshot;      // stav; atSeq = history.entries.length, bez historie 0
    readonly history?: TinycadHistory;
  }
  export interface TinycadHistory {
    readonly base: DocumentSnapshot;          // atSeq 0
    readonly entries: readonly LogEntry[];    // seq 1..n bez mezer
  }
  export function exportDocument(doc: DocumentReader): TinycadFile;   // bez historie (jako M4, jen formatVersion 2)
  export async function exportStoredDocument(
    store: DocumentStore, id: DocumentId,
    deps: { schemas: RegistryReader<FeatureSchema>; handlers: OpHandlerRegistry },
  ): Promise<Result<TinycadFile, LoadDocumentError>>;
  export async function importDocument(
    store: DocumentStore, raw: unknown,
    deps: { schemas: RegistryReader<FeatureSchema>; handlers: OpHandlerRegistry; newId: DocumentId; now: number },
  ): Promise<Result<DocumentMeta, DocumentLoadError>>;   // + handlers (volající v testech doplnit)
  ```
  - `exportStoredDocument`: stav jako `loadDocument` (bez `verify`), základní snapshot zkontrolovaný (chyba → `snapshot` s `which: 'base'`), záznamy jako `parseLogEntry` je vrátí (aktuální verze operací); `snapshot` = `createSnapshot(stav, n)`, `history.base` = snapshot základního dokumentu po `fromData` (migrované featury). Výsledek zmrazený, čisté JSON.
  - `importDocument`: `formatVersion` 1 nebo 2 (jiná → issue `formatVersion`); verze 1 a verze 2 bez `history` jako v M4 (`snapshot.atSeq` musí být 0). S historií: `history` objekt, `history.base` jako snapshot s `atSeq` 0 (cesty `history.base.…`), `history.entries` pole, každý záznam `parseLogEntry` se `seq === i + 1` (cesty `history.entries[i].<cesta>`), `snapshot.atSeq === entries.length` (`snapshot.atSeq`); přehrání `base` + `entries` po jednom (výjimka handleru → issue `history.entries[i]` se zprávou), `rebuildUndoStacks` nevyhodí (jinak issue `history.entries`), `toData` přehraného studia hluboce rovno `toData` studia snapshotu (jinak issue `history` „Replayed history does not match the snapshot“ – chyba dat ze souboru, ne programu). První vadná skupina ukončí kontrolu (obálka → snapshot → base → záznamy → přehrání).
  - Uložení: `meta = { ...snapshot.meta, id: newId, createdAt: now }` v základním snapshotu i ve stavu; `createDocument(meta, base)`, pak (je-li `n > 0`) `appendEntries(entries)` a `saveSnapshot(stav s atSeq n)`. Selže-li zápis po `createDocument`, zkusí `deleteDocument(newId)` (chyba úklidu se zahodí) a odmítne původní chybou. Vadný soubor neuloží nic.
- **Testy** (s `MemoryDocumentStore` a skutečným dispečerem/logem z `ops/testing`): 30 operací včetně undo/redo a dávky → `exportStoredDocument` → `importDocument` → `loadDocument(newId, { verify: true })` má stejné `toData` (až na `meta.id`, `createdAt`) a `rebuildUndoStacks` stejné zásobníky; soubor projde `JSON.parse(JSON.stringify(file))`; `exportDocument` + import (bez historie) jako M4; soubor verze 1 z M4 (literál v testu) se načte; každá chyba zvlášť s cestou: `formatVersion` 3, `history` ne-objekt, base s `atSeq` 1, mezera v `seq`, vadná operace v záznamu, záznam, který handler odmítne, `snapshot.atSeq ≠ n`, podvržený snapshot (jiná featura) → `history`; žádná chyba nic neuloží (`listDocuments` prázdný); selhání `appendEntries` (obal storu) → dokument smazaný a odmítnutí; `exportStoredDocument` neexistujícího id → `not-found`; vadný base → `snapshot`/`base`.
- **Hotovo když:** testy a `npm run check` projdou; `persistence` exportuje `exportStoredDocument`, `TinycadHistory`.

#### Ú3 `interaction`: panel historie a akce exportu
- **Soubory:** `src/interaction/history-model.ts` (nový), `file-actions.ts` (nový), `index.ts`, `testing.ts` (`FakeFileExporter` s ručním vyřízením) + testy `history-model.test.ts`, `file-actions.test.ts`, `index.test.ts`.
- **Kontrakt** ([[10-interakce#Historie úprav: `HistoryModel`]], [[10-interakce#Export: akce Soubor]]):
  ```ts
  export interface HistoryRow { readonly seq: number; readonly kind: 'do' | 'undo' | 'redo'; readonly label: string; readonly time: number;
    readonly target: number | null; readonly status: 'active' | 'undone' | 'abandoned' | null }
  export interface HistoryState { readonly rows: readonly HistoryRow[]; readonly total: number }
  export const HISTORY_LIMIT = 200;
  export interface HistoryModel extends Disposable { readonly state: Observable<HistoryState> }
  export function createHistoryModel(deps: { log: OperationLogReader }): HistoryModel;

  export const FILE_ACTION_IDS = { exportStep: 'file.exportStep', exportDocument: 'file.exportDocument' } as const;
  export interface FileExporter { exportStep(bodies: readonly BodyId[]): Promise<void>; exportDocument(): Promise<void> }
  export type FileTask = 'step' | 'document';
  export type FileStatus = { readonly kind: 'idle' } | { readonly kind: 'running'; readonly task: FileTask }
    | { readonly kind: 'failed'; readonly task: FileTask; readonly message: string };
  export interface FileActions extends Disposable { readonly status: Observable<FileStatus>; dismiss(): void }
  export function createFileActions(deps: {
    registry: ActionRegistry; exporter: FileExporter; regen: RegenStatusPort;
    browser: Pick<BrowserModel, 'hidden'>; editor: Pick<FeatureEditor, 'current'>; mode: Observable<Mode>;
  }): FileActions;
  ```
  - Historie: řádky nejnovější první, nejvýš `HISTORY_LIMIT`, `total` = počet záznamů logu; `status` u `do` podle `rebuildUndoStacks(log.entries())` (na undo zásobníku `active`, na redo `undone`, jinde `abandoned`), u `undo`/`redo` `null`; nezměněný řádek je tentýž objekt; zmrazené; `dispose` odhlásí odběr `appended`.
  - Akce: `group: 'file'`, `label` = id, bez zkratek, režim jen `model`. `exportStep` povolená ⇔ stav není `running` ∧ `editor.current === null` ∧ režim `model` ∧ aspoň jedno těleso posledního snapshotu mimo `hidden`; spustí `exporter.exportStep(viditelná tělesa v pořadí snapshotu)`. `exportDocument` povolená ⇔ stav není `running`. Průběh `running` → `idle`, odmítnutí → `failed` se zprávou (`Error.message`, jinak `String(e)`); `dismiss` jen z `failed` na `idle`. Akce se zaregistrují při vytvoření, `dispose` odhlásí odběry.
- **Testy:** historie – prázdný log; `do` ×3 → tři řádky `active` v obráceném pořadí; undo → nový řádek `undo` s `target` a původní `do` `undone`; redo → `active`; undo + nové `do` → vrácený `abandoned`; 250 záznamů → 200 řádků, `total` 250; nezměněné řádky `===` po dalším záznamu; log obnovený z uložených záznamů (`createOperationLog(entries)`) dá stejné řádky. Akce – zakázaná bez těles, se všemi skrytými, s otevřeným dialogem, v režimu skici; exportStep předá jen viditelná tělesa v pořadí; během běhu obě akce zakázané a stav `running`; vyřízení → `idle`; odmítnutí → `failed` se zprávou, `dismiss` → `idle`; `dispose`.
- **Hotovo když:** testy a `npm run check` projdou; `interaction` exportuje nové funkce a typy.

#### Ú4 `document`, `ops`: barva tělesa
- **Soubory:** `src/document/model.ts` (`BodyMeta.color`), `cad-document.ts` (kanonický tvar, rovnost), `serialization`/`fromData` (soubor podle kódu) + testy; `src/ops/operation.ts` (typ `body.setColor`), `handlers/body.ts`, registrace vestavěných handlerů, `replay.property.test.ts` (generátor), testy handlerů a `validate`.
- **Kontrakt** ([[03-dokument#Metadata těles]], [[04-operace-a-historie#Sada operací]]):
  ```ts
  export interface BodyMeta { readonly name?: string; readonly hidden?: true; readonly color?: string }   // '#rrggbb' malými písmeny
  export function isBodyColor(v: unknown): v is string;   // /^#[0-9a-f]{6}$/; document, export
  // ops: { type: 'body.setColor'; v: 1; body: BodyId; color: string | null }   // null = výchozí barva
  ```
  - Kanonický tvar: `color` jen jako platná barva; metadata jen s výchozí barvou se odeberou jako dosud. `fromData`: `color` musí projít `isBodyColor` (jinak issue `studio.bodies['<klíč>'].color`).
  - Handler: inverze = předchozí barva (nebo `null`), `validate`: `body` přes `parseBodyId`, `color` `null` nebo `isBodyColor` (velká písmena neprojdou – determinismus přehrání bez kanonizace v handleru); shodná hodnota je platná operace (nic nemění).
- **Testy:** `setBodyMeta` s barvou, odebrání barvy, kanonický tvar (prázdná metadata zmizí), `fromData` platná a neplatná barva (`#FFF`, `#ABCDEF`, `red`, číslo); handler `invert → apply → apply(inverze)` = původní `toData`; `validate` s rozbitým `body` a `color`; property test logu zahrnuje `body.setColor`.
- **Hotovo když:** testy a `npm run check` projdou; tabulka vestavěných handlerů má 10 řádků.

#### Ú5 `render`: barva tělesa
- **Soubory:** `src/render/body-layer.ts`, `body-view.ts`, `viewport.ts` (`setBodyColor`), `palette.ts` (jen je-li potřeba převod `#rrggbb` → číslo, čistá funkce `parseHexColor`), testy `body-layer.test.ts`, `palette.test.ts`.
- **Kontrakt** ([[09-vykreslovani#Viewport]], [[09-vykreslovani#Reprezentace tělesa]]): `Viewport.setBodyColor(body: BodyId, color: string | null): void` – `color` ve tvaru `#rrggbb`; těleso s barvou dostane vlastní materiál ploch (kopie sdíleného s jinou barvou; materiály podle barvy sdílené mezi tělesy se stejnou barvou a uvolněné, když je nikdo nepoužívá), `null` → sdílený materiál palety. Stav barvy přežije `sync`, když těleso zůstane (i s novým handle), a zmizí s tělesem jako viditelnost; `setPalette` barvy těles nemění (mění jen výchozí); hrany zůstávají v barvě palety. Volání se stejnou hodnotou nepřekresluje, jinak `requestRender()`.
- **Testy:** čisté `parseHexColor` (platná, neplatná → výjimka); `BodyLayer` (stávající testovací pomůcky): barva se použije na zobrazené těleso, přežije `sync` s novým handle, zmizí s tělesem, `null` vrátí výchozí, stejná hodnota bez `requestRender`, dvě tělesa se stejnou barvou sdílí materiál a uvolní ho až poslední, `setPalette` nemění obarvené těleso.
- **Hotovo když:** testy, `npm run check` a `npm run build` projdou; ruční kontrola na dev stránce (ohlásit).

#### Ú6 `tests`: měření výkonu
- **Soubory:** `tests/perf.test.ts` (nový), případně `tests/perf-model.ts` (stavba modelu).
- **Kontrakt** ([[13-testovani#Měření výkonu]], R130): propojení jako `tests/topo-scenarios.test.ts` (dokument, dispečer, `Regenerator`, pluginy přes `registerPlugin`) s `createInThreadOcctKernel()`. Jádro obalené **počítadlem volání** přes `Proxy` (ne ručním výčtem metod – rozhraní se ve vlně A rozšiřuje o `exportStep`). Model: deska (kvádr 200 × 200 × 20), 36 válců r = 4 v mřížce 6 × 6 přes celou tloušťku, jeden Boolean „odebrat“ (cíl deska, nástroje válce), zaoblení 4 svislých hran desky (jména podle [[0018-format-topologickych-jmen|ADR 0018]], dohledaná z `NameTable`) – ~40 featur.
  - Měří (každé 3×, vypíše medián v ms a počty volání jádra přes `console.table`): první regenerace od nuly; tessellace výsledného tělesa (`{ linearDeflection: 0.1, angularDeflection: 0.5 }`, jako `MESH_QUALITY`); změna výšky desky (první featura → plný přepočet); změna poloměru posledního válce (cache featur před ním).
  - **Nikdy neověřuje čas.** Ověřuje: žádná featura s chybou, jedno těleso, počet ploch z `topology` (6 + 36 + 4), při změně posledního válce počet volání `makeBox` 0 a `makeCylinder` 1, po každém kroku `liveHandleCount` = počet živých handle stavu.
- **Ověřit a ohlásit:** naměřená čísla (tabulka do zprávy, hlavní sezení je zapíše do Q007); úmyslnou chybou, že kontrola cache spadne (dočasně vypnutá cache v testu – např. nový `Regenerator` pro každý krok – a test musí padnout; poznatek [[Měření, které nemůže selhat]]); doba celého testu.
- **Hotovo když:** `npm run test:integration` a `npm run check` projdou; test trvá < 30 s.

### Vlna B

#### Ú7 `interaction`: barva v Prohlížeči
- **Soubory:** `src/interaction/browser-model.ts`, `index.ts` (jen je-li nový typ) + `browser-model.test.ts`.
- **Kontrakt** ([[10-interakce#Prohlížeč: `BrowserModel` a viditelnost těles]]): `BrowserBodyRow.color: string | null` (z metadat), `BrowserModel.colors: Observable<ReadonlyMap<BodyId, string>>` (tělesa poslední regenerace s barvou; `app` → `viewport.setBodyColor`), `setColor(body, color: string | null)` → `dispatch body.setColor` se stejnými pravidly jako `setVisible` (neznámé těleso, otevřená transakce, `canEdit: false`, shodná hodnota → nic; neplatná barva → výjimka). Pořadí vyslání: `hidden`, `colors`, `visiblePlanes`, `visibleAxes`, `bodies`, …; nová mapa jen při změně obsahu.
- **Testy:** řádek nese barvu z metadat; `setColor` → operace a undo vrátí barvu; `colors` jen pro tělesa poslední regenerace; beze změny žádný nový snapshot; zákazy jako u `setVisible`; neplatná barva vyhodí.
- **Hotovo když:** testy a `npm run check` projdou.

### Vlna C

#### Ú8 `app`: exportér, stažení, import, historie, barvy
- **Soubory:** `src/app/registries.ts` (nový: `createPluginRegistries(plugins)` vytažené z `createAppSession` beze změny chování), `file-exporter.ts` (nový), `file-names.ts` (nový: `safeFileName`), `documents.ts` (`importDocumentFile`), `kernel-supervisor.ts` (`kernel()`), `session.ts`, `browser.ts`, `testing.ts` (`FakeViewport.setBodyColor`, zachycené stažení), `index.ts` + testy (`session.test.ts`, `documents.test.ts`, `file-exporter.test.ts`, `file-names.test.ts`, `kernel-supervisor.test.ts`).
- **Kontrakt** ([[11-ui#Kompoziční kořen (app)]]):
  ```ts
  export interface DownloadFile { readonly name: string; readonly mime: string; readonly data: string | Uint8Array<ArrayBuffer> }
  // AppSessionDeps += download: (file: DownloadFile) => void;   OpenAppSessionOptions += download
  // AppSession += history: HistoryModel; files: FileActions; fileActionIds: typeof FILE_ACTION_IDS;
  //               defaultBodyColor: Observable<string>   // '#rrggbb' barvy ploch aktuální palety (mění setTheme), pro pole barvy v ui
  export function importDocumentFile(raw: unknown, opts: { plugins: readonly FeaturePlugin[] }): Promise<Result<DocumentId, DocumentLoadError>>;   // browser.ts
  // documents.ts: importDocumentFile(store, raw, { plugins, ids, now })
  export function safeFileName(name: string): string;   // internal
  // KernelSupervisor += kernel(): GeometryKernel | null
  ```
  - **Export STEP** (`FileExporter.exportStep(bodies)`): počká, až `RegenScheduler.busy` je `false`; pak **synchronně** vezme poslední `finalState` (týž, z jakého vznikl poslední `RegenSnapshot`) a živé jádro (`supervisor.kernel()`, `null` → odmítne), handle těles v pořadí `bodies` (chybějící přeskočí; žádné → odmítne) a hned zavolá `kernel.exportStep`. Pak `download({ name: safeFileName(doc.meta.name) + '.step', mime: 'model/step', data })`. Worker zpracuje export před případným `release` pozdější regenerace (pořadí zpráv), proto stačí nečinnost před voláním.
  - **Export dokumentu:** `flush()` (jen pro čtení: nic), `exportStoredDocument(store, docId, { schemas, handlers })`, chyba → odmítne; `download({ name: safeFileName(…) + '.tinycad.json', mime: 'application/json', data: JSON.stringify(file, null, 2) + '\n' })`.
  - `safeFileName`: znaky `\ / : * ? " < > |` a řídicí znaky → `_`, oříznout mezery a tečky na koncích, nejvýš 100 znaků, prázdné → `'tinycad'`.
  - `importDocumentFile`: registry z `createPluginRegistries`, nové id z generátoru, `now`, `importDocument`; vrací id nového dokumentu.
  - `createHistoryModel({ log })`, `createFileActions({ registry: actions, exporter, regen, browser, editor: features, mode })`; `browser.colors` → `viewport.setBodyColor` (rozdíl proti minulé mapě, jako `hidden`); `dispose` uvolní historii a akce.
- **Testy** (`FakeKernel`, `MemoryDocumentStore`, `FakeViewport`): po regeneraci kvádru `actions.run(fileActionIds.exportStep)` → jedno stažení `<jméno>.step` s textem `ISO-10303-21;`; skryté těleso → akce zakázaná; `failNext('exportStep', 'operation-failed')` → `files.status` `failed`; export během běžící regenerace počká a exportuje nový stav; export dokumentu → `JSON.parse` stažených dat → `importDocumentFile` (documents.ts) do stejného storu → nová session nad novým id má stejné `toData` studia a `canUndo`; vadný soubor → `err` a nic nového v `listDocuments`; `history.state` po vytvoření featury a undo; barva z Prohlížeče → `FakeViewport` zaznamená `setBodyColor`; `defaultBodyColor` podle tématu (`#b9c3d1` světlé, `#3b6aa6` tmavé); `safeFileName` (zakázané znaky, prázdné, dlouhé, tečky na konci); `supervisor.kernel()` během startu `null`, po `ready` jádro, po pádu `null`.
- **Hotovo když:** testy, `npm run check` a `npm run build` projdou; e2e M10–M14 beze změny.

### Vlna D

#### Ú9 `ui`: menu Soubor, import, panel historie, barva
- **Soubory:** `src/ui/download.ts` (nový: `downloadFile`), `history-text.ts` (nový: čistý text řádku), `components/TitleBar.vue` (menu Soubor, stav exportu, přepínač Historie), `components/HistoryPanel.vue` (nový), `components/AppShell.vue`, `components/DocumentList.vue` (Importovat), `components/Browser.vue` (barva), `App.vue`/`start.ts` (předání `download` a `importDocumentFile`), `src/ui/i18n/cs.ts`, `en.ts` + testy (`download.test.ts`, `history-text.test.ts`, `i18n.test.ts`).
- **Kontrakt** ([[11-ui#Komponenty]]):
  ```ts
  export interface DownloadEnv { createObjectURL(b: Blob): string; revokeObjectURL(u: string): void; click(href: string, name: string): void; later(fn: () => void): void }
  export function downloadFile(file: DownloadFile, env?: DownloadEnv): void;   // výchozí env = prohlížeč (<a download>, setTimeout 1000 ms před revoke)
  export function historyText(row: HistoryRow, t: (key: string, params?: Record<string, unknown>) => string, te: (key: string) => boolean): string;
  ```
  - **Menu Soubor** v `TitleBar`: tlačítko `ti-file-export` s přístupným názvem „Soubor“ otevře `ContextMenu` s akcemi `group: 'file'` ze `session.actions` (zakázané šedě); vedle stav `session.files.status` – `running` „Exportuji…“, `failed` „Export se nezdařil“ (`role="alert"`, technická zpráva v `title`, × volá `files.dismiss()`).
  - **Historie:** tlačítko `ti-history` („Historie úprav“, `aria-pressed`) přepíná `HistoryPanel` (stav panelu je jen rozvržení, `ref` v `AppShell`); panel plovoucí vpravo, kreslí se jen bez dialogu featury a panelu skici; seznam (`role="list"`) řádků: čas `HH:MM:SS` (`Intl.DateTimeFormat` podle jazyka), text z `historyText`, `undone` šedě kurzívou, `abandoned` přeškrtnuté; při `total > rows.length` patička „Starší záznamy: {n}“.
  - `historyText`: popisek přeložený, existuje-li klíč (`te`), jinak surový; `undo` → `t('history.undo', { label })`, `redo` → `t('history.redo', { label })`.
  - **Import** v `DocumentList`: tlačítko „Importovat“ (`ti-file-import`) a skrytý `<input type="file" accept=".json,application/json">`; přečte text, `JSON.parse` (chyba → „Soubor není platný dokument tinycad“), `importDocumentFile` → `ok` otevře `#/d/<id>`, `err` → stejná hláška + první issue (`path: message`) v `title`.
  - **Barva** v `Browser`: u řádku tělesa `<input type="color">` (`aria-label` „Barva {name}“, hodnota `row.color ?? session.defaultBodyColor`), změna → `browser.setColor`; je-li barva nastavená, tlačítko „Výchozí barva“ (`ti-palette`) → `setColor(body, null)`; zakázané podle `canEdit`.
  - **Překlady** (cs / en): `file.exportStep` „Exportovat STEP“ / “Export STEP”, `file.exportDocument` „Exportovat dokument“ / “Export document”, `titleBar.file` „Soubor“ / “File”, `file.running` „Exportuji…“ / “Exporting…”, `file.failed` „Export se nezdařil“ / “Export failed”, `history.title` „Historie úprav“ / “Edit history”, `history.undo` „Zpět: {label}“ / “Undo: {label}”, `history.redo` „Znovu: {label}“ / “Redo: {label}”, `history.older` „Starší záznamy: {n}“ / “Older entries: {n}”, `documents.import` „Importovat“ / “Import”, `documents.importError` „Soubor není platný dokument tinycad“ / “The file is not a valid tinycad document”, `browser.color` „Barva {name}“ / “Color of {name}”, `browser.defaultColor` „Výchozí barva“ / “Default color”; popisky vestavěných operací pro historii (klíč = typ operace, kde ještě není): `feature.add` „Přidat featuru“, `feature.remove` „Odebrat featuru“, `feature.setParams` „Změnit parametry“, `feature.move` „Přesunout featuru“, `studio.setRollback` „Posunout rollback bar“, `body.rename` „Přejmenovat těleso“, `body.setVisible` „Viditelnost tělesa“, `body.setColor` „Barva tělesa“, `batch` „Více změn“ (en obdobně).
- **Testy:** `downloadFile` s falešným `env` (Blob se správným typem a obsahem, jméno, revoke až v `later`); `historyText` (klíč přeložený, neznámý surový, undo/redo); i18n – cs a en mají stejné klíče, každý vestavěný typ operace má popisek.
- **Hotovo když:** testy, `npm run check` a `npm run build` projdou; ruční kontrola v prohlížeči (ohlásit).

### Vlna E

#### Ú10 `e2e`: export a import
- **Soubory:** `e2e/m15.spec.ts` (nový), pomocné funkce v `e2e/helpers.ts`.
- **Scénář** (OCCT v prohlížeči, česky, prvky přes role a přístupné názvy, `page.waitForEvent('download')`):
  1. Nový dokument → „Kvádr“ → „OK“ → „Soubor“ → „Exportovat STEP“ → stažený soubor `Bez názvu.step`, obsah začíná `ISO-10303-21;`.
  2. „Válec“ → „OK“ → „Historie úprav“ → panel ukazuje dva řádky („Válec“, „Kvádr“) → „Zpět“ → nahoře řádek „Zpět: Válec“, řádek „Válec“ vrácený → „Znovu“.
  3. Barva prvního tělesa v Prohlížeči na `#ff0000` → reload → pole barvy má `#ff0000`.
  4. „Soubor“ → „Exportovat dokument“ → stažený `Bez názvu.tinycad.json` → „Dokumenty“ → „Importovat“ (`setInputFiles` se staženou cestou) → otevře se nový dokument, Timeline „Kvádr 1“, „Válec 1“ bez chyby → „Zpět“ ×2 (barva, pak Válec 1) → „Válec 1“ zmizí.
  5. Konzole bez chyb.
- **Hotovo když:** `npm run test:e2e` projde v Chrome i WebKit; `npm run check`, `npm run build` zelené.

### Vlna F

#### Ú11 Hlavní sezení
- Zkontrolovat kód Ú1–Ú10 proti specifikacím, propsat odchylky (03, 04, 05, 06, 09, 10, 11, 13), převést otázky implementátorů na otázky ve vaultu (rovnou rozhodnuté).
- Čísla z Ú6 zapsat do [[Q007 Cache geometrie|Q007]] (sekce Rozhodnutí, dodatek s měřením); kdyby otevření modelu trvalo > 2 s, R131 přehodnotit a zapsat nápad cache do „Další nápady“ s čísly.
- Projít `grep -l 'status: open' docs/60-otazky/*` – nové otázky z implementace rozhodnout; `01-inbox/` roztřídit.
- `architecture-reviewer` (hlavně: `interaction` nezná DOM ani jádro, stažení jen v `ui`, `ExchangeOps` mimo `ModelingKernel`), oprava nálezů, retrospektiva milníku i celé první verze, poznatky (kandidáti: export přes virtuální FS Emscriptenu; historie jako ověřitelná data – import přehráním; měření výkonu bez časových asercí), spec statusy (`05`, `06`, `10`, `11` zůstávají `implemented`, `13` → `accepted`), `/milnik konec M15`, commit.
- [x] Ú11a Oprava nálezů revize (`history`/`files` v `AppSession` bez `dispose`, `BUILT_IN_OPERATION_TYPES` z `app`, úzké závislosti exportéru, `fileMenuItems` podle `fileActionIds`, `HistoryState.older`, `importDocumentText` bez výjimek, `defaultBodyColor` z počátečního tématu, stav vráceného řádku pro čtečky, perf test hledá hrany z topologie)

## Co se naučíš

- Jak se z WASM modulu dostane soubor: Emscripten FS jako paměťový souborový systém, `STEPControl_Writer` píše do cesty, adaptér bajty přečte a smaže – port zůstává „tvary dovnitř, bajty ven“.
- Proč export historie potřebuje základní snapshot a jak import ověří soubor přehráním logu (stejný invariant jako `verify` při načtení).
- Jak oddělit akci (pravidla povolení, stav běhu v `interaction`) od platformy (jádro a jméno souboru v `app`, Blob a `<a download>` v `ui`).
- Jak měřit výkon tak, aby test nikdy nelhal: měřit a vypisovat, ověřovat jen deterministické veličiny (počty volání, úklid).

## Další nápady (mimo rozsah)

- Vlastní C++ modul OCCT přes Emscripten místo předpřipraveného buildu (výměna adaptéru za portem). → samostatný milník [[M16-vlastni-occt-build]].
- Jádro na serveru jako alternativní adaptér `GeometryKernel`.
- Proměnné a výrazy v parametrech ([[Q003 Proměnné a výrazy v parametrech|Q003]] – návrh `number | Expr` a zkrácení cache podle `variables`).
- Popis a barva featury ([[Q004 Popis a barva featury|Q004]]).
- Větvení verzí nad operačním logem ([[Q006 Větvení operačního logu|Q006]]), návrat k záznamu z panelu historie (R127).
- Více Part Studií v dokumentu ([[Q001 Jedno nebo více Part Studií|Q001]]).
- Přepočet podle grafu závislostí místo lineárně ([[Q013 Graf závislostí featur|Q013]]), více workerů jádra ([[Q011 Více workerů jádra|Q011]]) – až měření ukáže potřebu.
- Persistentní cache geometrie (BREP/sítě) pro rychlé otevření ([[Q007 Cache geometrie|Q007]], R131).
- Průhlednost těles a „zprůhlednit ostatní“ při editaci ([[Q073 Průhlednost a barva těles|Q073]], R129).
- STEP s barvami a jmény (XCAF), import STEP, STL (R123).
- **Boolean s více výslednými tělesy** (R8, R100, R132): dotaz jádra na rozklad výsledku na solidy s historií, `bodyId(cíl.origin, n)` podle rodokmenu (např. podle nejmenšího jména plochy solidu), ošetření kolize id a pravidlo, který kus zachová původní id (reference na `A/body`); test „změna parametru válce nepřehodí id dvou výsledných těles“. Platí i pro „odebrat“ ve Vysunutí (R67). Vlastní milník s ADR (dotýká se [[0015-artefakty-a-identita-telesa|ADR 0015]]).
- **Automatické cíle vysunutí** „sloučit se vším, čeho se dotkne“ (R66, R109): dotaz jádra na průnik (`BRepExtrema_DistShapeShape` je v buildu).
- **Obecné „Po plochu“** (nerovinná nebo nerovnoběžná plocha, „Po další“) – `BRepFeat_MakePrism` nebo řez hranolem (R109).
- **Vrcholy:** `PickKind 'vertex'`, reference na vrchol (R101).
- **Čipy referencí `topo`** v dialogu s čitelným jménem a × (R103).
- **Zkosení dvěma vzdálenostmi / vzdáleností a úhlem, zaoblení s proměnným poloměrem** (R105).
- Interaktivní tvorba kvádru tažením ve viewportu (vlastní `Tool`, mezivýsledky přes `FeatureEditSession.setParam`) – přesunuto z [[M09-interakce]] přes [[M13-extrude-revolve|M13]] ([[Rozhodnutí noční rychloakce#M13 – Extrude a Revolve|R79]]).

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_Návrh (noční rychloakce), Pavel doplní._

**Co bylo jinak, než se čekalo**
- Plán M15 vznikl před implementací M13 a M14 a přesto sedl: kontrakty M15 byly úzké (port `ExchangeOps` jen „tvary dovnitř, bajty ven“, `HistoryModel` jen nad logem, barva jako další pole metadat), takže se jich změny v M13/M14 skoro nedotkly.
- STEP šel přes `oc.FS` (paměťový souborový systém Emscriptenu) s předpřipraveným buildem – [[M16-vlastni-occt-build|M16]] nebyl potřeba ani pro export. Jediné překvapení buildu: `BRep_Builder` není vázaný, `MakeCompound`/`Add` jsou na `TopoDS_Builder`.
- Měření ukázalo ~0,1 s na model s 39 featurami (boolean a zaoblení dominují, cache featur ušetří ~10 %), takže persistentní cache geometrie je zbytečná a R131 platí ([[Q007 Cache geometrie|Q007]]).
- Revize M15 našla nejméně nálezů z M11–M15 (vesměs úzké závislosti a drobnosti přístupnosti, Ú11a); kontrolní seznam ADR v zadání úkolů pomohl ([[Kontrolní seznam plánu proti ADR]]).
- Fake jádro nesmí `TextEncoder` (doménový tsconfig bez DOM), pseudo-STEP kóduje ASCII ručně; e2e potřeboval dvě „Zpět“, protože poslední záznam logu byla barva.

**Co se osvědčilo**
- Port + adaptér pro export: `interaction` zná jen pravidla akce, `app` jádro a jméno souboru, `ui` Blob a `<a download>`; každá vrstva se testuje bez té pod ní.
- Import přes přehrání logu: soubor s historií se ověří stejným invariantem jako `verify` při načtení (přehraný základ = snapshot), takže podvržený nebo poškozený soubor se odmítne, ne uloží.
- Měření výkonu bez časových asercí: test vypisuje časy a ověřuje jen počty volání jádra a úklid handle ([[Měření, které nemůže selhat]]).

**První verze celkově (M0–M15)**
- Noční rychloakce: M11–M15 implementovány bez průběžného schvalování, všechna rozhodnutí s ⚠ k revizi jsou v [[Rozhodnutí noční rychloakce]] (shrnutí nahoře). Postup „kontrakt ve vaultu → implementer → kontrola → revize“ fungoval i bez Pavla; odchylky se propisovaly na konci milníku.
- Předpřipravený OCCT build (R1) vydržel celou první verzi; M16 se nedělá.
- Opakovaně odkládané: rozpad booleanu na víc těles (R8 → R100 → R132) – potřebuje vlastní milník s ADR o identitě.

**Čísla:** poslední běh `npm run check` 4144 unit testů ve 171 souborech, `npm run test:integration` 33 testů v 7 souborech, `npm run test:e2e` 20 testů (Chrome a WebKit).

**Zúžení** (⚠ v [[Rozhodnutí noční rychloakce#M15 – Export a dokončení]]): R122 export jen všech viditelných těles, R123 STEP bez barev a jmen a bez importu, R125 export vždy s historií, R127 panel historie jen ke čtení, R129 barva bez průhlednosti, R131 bez cache geometrie, R132–R133 zbytek úkolů z M14 do Dalších nápadů.
