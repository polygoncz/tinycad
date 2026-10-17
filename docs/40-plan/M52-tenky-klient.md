---
type: milestone
status: done
order: 52
aliases:
  - M52
  - M52 Tenký klient
modules:
  - app
  - interaction
  - sketcher
  - ops
  - document
  - ui
  - remote
specs:
  - "[[01-architektura]]"
  - "[[03-dokument]]"
  - "[[04-operace-a-historie]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
  - "[[13-testovani]]"
  - "[[14-protokol]]"
depends_on:
  - "[[M48-hlaseni-v-ui]]"
  - "[[M49-pravidla-validace-v-popisu]]"
started: 2026-10-17
finished: 2026-10-18
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-18
---
# M52 – Tenký klient

**Cíl:** Klient nemá handlery operací ani měnitelný dokument; stav je jen read model ze serveru a změny jdou přes server ([[0031-tenky-klient-bez-handleru|ADR 0031]], N63).

> Upřesněno 2026-10-17 (plánovač, po sloučení M48 a M49): rozhodnutí [[Rozhodnutí nativního jádra#Plán M52 – tenký klient|N163–N172]]. [[M50-occt2d-a-vrstva-rpc|M50]] běží souběžně jen v `server/`, s M52 se nepotká. [[M51-inverze-a-mereni|M51]] mění chování serveru po `STORAGE`; pravidlo klienta (N167) platí před M51 i po něm.

**Specifikace:** [[01-architektura]], [[03-dokument]], [[04-operace-a-historie]], [[10-interakce]], [[11-ui]], [[13-testovani]], [[14-protokol]]

**Navazuje na:** [[M48-hlaseni-v-ui]], [[M49-pravidla-validace-v-popisu]]

## Návrh: jak funguje každá interakce bez lokálního použití operací

Dnes `RemoteDispatcher` každou změnu hned použije na zrcadlo TS handlery a po odpovědi zrcadlo přestaví (N63). Po M52 dispečer **jen posílá**: `dispatch`/`apply` = `RemoteSession.change(…)`, výsledek = slib `true`/`false`, dokument se změní, až sezení zveřejní read model odpovědi. Inventura volajících ukázala, že většina na výsledek nečeká, takže je to menší změna, než se zdálo:

| Kdo mění dokument | Dnes | Po M52 |
|---|---|---|
| Strom (`feature-tree.ts`: přejmenování, posun baru, přesun), Prohlížeč (`browser-model.ts`: jméno, viditelnost, barva, materiál tělesa), jméno dokumentu (`document-name.ts`), mazání (`builtin-actions.ts`, dávka v transakci) | `ops.dispatch(op)` / `begin`+`apply`+`commit`, návratovou hodnotu nikdo nečte | totéž s `void ops.dispatch(op)`; změna je vidět s odpovědí, mezitím ukazatel „čeká“ (N168). Stráže nad starým dokumentem (stejné jméno, porušení pořadí) zůstávají; co propustí zastaralý read model, odmítne server s hlášením. |
| Undo/redo (`builtin-actions.ts`) | už dnes čeká na odpověď (N64) | beze změny; `canUndo`/`canRedo` z posledního read modelu a bez otevřené transakce |
| Dialog featury (`feature-editor.ts`) | `tx.apply` a hned čte parametry z dokumentu | **rozpracované hodnoty** (N164): session drží kopii parametrů, dokud server nepřijme poslední odeslanou změnu; pak čte read model |
| Manipulátory (`manipulator-controller.ts`) | `session.setParams` při každém pohybu, čte `session.state` | beze změny kódu: čte rozpracované hodnoty, slučování „poslední vyhrává“ dělá fronta změn (`ChangeQueue` nahradí čekající `apply` `setParams` téže featury) a server v transakci (spec 04) |
| Skicář (`sketch-session.ts`) | každá vyřešená úprava → `edit.setParams`, data čte z `edit.state` | beze změny kódu (N172): data čte z rozpracovaných hodnot, po přijetí převezme souřadnice serveru (Q097) |

**Proč rozpracované hodnoty (N164 ⚠).** `applyPatch` skládá patch přes *aktuální* parametry; dva rychlé `setParam` za sebou by bez kopie poslaly druhý patch nad starými parametry a první hodnotu ztratily. Manipulátor bere výchozí hodnoty tažení z `session.state.get().params` a skicář staví další krok z `readData()` – oba hned po předchozím zápisu. Kopie je stav UI dialogu (co uživatel zadal), ne doména: vzniká jen z patche, bez handleru a bez znalosti jiných operací.

**Pravidlo „poslední vyhrává“ v dialogu.** Každé odeslání (`tx.apply` z `applyPatch` i `feature.add` z `create`) dostane pořadové číslo `n`. Když se vyřeší odeslání `n`:

- přijato a `n` je poslední odeslané → rozpracované hodnoty se zahodí a `EditState.params` čte dokument (už ukazuje read model odpovědi, protože ho sezení zveřejní dřív, než vyřeší slib – N165);
- přijato, ale později se odeslalo další → nic (čeká se na poslední);
- odmítnuto → rozpracované hodnoty zůstanou (do další přijaté změny nebo do konce session). Hlášení ukáže `app` (`noticeOfRefusal`). Commit zapíše poslední serverem přijatý stav – N65 tak platí pro všechny featury.

**Ztráta transakce.** Dnešní cesta zůstává: událost sezení `lost` → transakce dispečera je no-op → `onLost` zavře dialog (`features.current.get()?.cancel()`) a hlášení `notice.transactionLost` dělá `connectNoticeSources`. Nově se stejně chová odmítnutý `BeginTransaction` a `NO_TRANSACTION` u kroku (N167).

**Konec transakce.** OK a Zrušit zavřou session hned (lokálně `inTransaction` = false), `Commit`/`Abort` jde frontou za kroky. Odmítnutý `Commit` → hlášení a `Abort` best effort (N167, řeší N157).

**Dokument pro UI (N165).** `AppSession.doc` je čtecí pohled nad neměnným snímkem posledního read modelu (`createSnapshotDocument` v `document`). Sdílení nezměněných featur (dnes `MirrorDocument.shared`) zůstává, protože dialog a strom porovnávají identitou. `replace` volá jen `app` z odběru `session.readModel`.

**Co zbude z `ops` a `document` (N165, N166).** `ops` = typy operací, `OP_VERSION`, porty (`ops/ports.ts`) a v testech `FakeOps`. `document` = typy modelu, reference, počátek, `references.ts`, schéma a registr, `validateAgainstSchema`, `checkParamRules`, `evaluateParams` (validace v dialogu, M49) a nový snímkový dokument. Pryč: handlery, registr handlerů, `applyOperation`, paměťový dispečer, log, transakce, undo, `createDocument`/`DocumentWriter`/`cad-document.ts`, `serialize.ts`, TS běžec `ops.script`.

**Latence a výpadek (N168).** Žádné zakazování ovládacích prvků navíc; čekání ukazuje dnešní `RegenUiState.busy` (Timeline) a `persistence: 'pending'` (titulek). E2E proto po M52 ověřují konečný stav a počet záznamů, ne mezistavy (viz úkol 5).

## Úkoly

- [x] 1. Porty po M52, snímkový dokument, tenký `RemoteDispatcher` a rozpracované hodnoty dialogu; přechodový `anOpsSession` nad starým dvojníkem.
- [x] 2. Testy `interaction` a `sketcher` na `FakeOps` a `aSnapshotDocument`; přechodový adaptér pryč z testů.
- [x] 3. Mazání: handlery a paměťový dvojník `ops`, měnitelný model a serializace `document`, TS běžec `ops.script`, pravidla závislostí.
- [x] 4. Jeden `ToastStack` (N160, N170) a `noticeOfRefusal` bez undo/redo souběhu (N169).
- [x] 5. E2E latence a výpadku po M52, nový scénář stromu a undo pod latencí, měření bundlu, `test:e2e:full`.
- [x] 6. Specifikace 01, 03, 04, 10, 11, 13, 14, ADR 0031 a pojem (hlavní sezení).

## Akceptační kritéria

- `rg -n "applyOperation|OpHandler|DocumentWriter|MirrorDocument|createOperationDispatcher|anOpsSession" src test` nic; `ls src/ops` = `index.ts`, `operation.ts`, `ports.ts`, `testing.ts`; v `src/document` není `cad-document.ts` ani `serialize.ts`.
- Dokument v klientovi je jen čtecí pohled (`createSnapshotDocument`), `replace` volá jediné místo v `app/remote-session.ts`.
- Dialog featury: dvě rychlé změny různých parametrů obě dojdou na server; odpověď na starší změnu nepřepíše pole s novější hodnotou; po přijetí poslední změny dialog ukazuje read model (unit testy úkolu 1).
- `npm run check` zelený; `npm run test:e2e:full` zelené včetně `m46-latency`, `m46-outage` a projektu `restart`.
- Velikost bundlu před a po zapsaná v retrospektivě.

## Co se naučíš

Klient nad read modelem bez optimismu: co to stojí v odezvě UI (strom ukáže změnu o dobu odezvy později) a co to ušetří ve složitosti (žádná pravidla pořadí zrcadla, jedna implementace domény). A kde i „tenký“ klient potřebuje kousek vlastního stavu: rozpracované hodnoty formuláře nejsou doména, ale vstup uživatele.

## Implementační plán

Úkoly 1–5 = subagent `implementer` (Opus), v pořadí 1 → 5, po každém zelený `npm run check` (N171). Úkoly 2 a 4 mají disjunktní soubory a mohou běžet souběžně ve dvou worktree; doporučeno postupně. Úkol 6 dělá hlavní sezení. Pro všechny:

- **Testy po větších celcích (N2):** během úkolu cílené `npx vitest run test/unit/<modul>`, `npm run typecheck`, `npm run lint:deps`; celý `npm run check` na konci úkolu; e2e jen v úkolu 5.
- **Žádný optimismus mimo dialog:** nový kód nesmí stavět dokument z odeslaných operací. Jediný lokální stav změn jsou rozpracované hodnoty `FeatureEditSession` (N164).
- **Sliby nikdy neodmítají** kvůli chybě serveru: `Promise<boolean>`; chybu hlásí `app` přes `onError` → `noticeOfRefusal`. Volající, kteří na výsledek nečekají, píšou `void ops.dispatch(op)` (ESLint `no-floating-promises`).
- **Rozpor se specifikací** → otázka v hlášení implementátora, ne tiché rozhodnutí.

### 1. Porty, snímkový dokument, tenký dispečer, rozpracované hodnoty

- **Soubory:** `src/ops/ports.ts`, `src/ops/index.ts`, `src/ops/testing.ts` (nový `FakeOps` + přechodový `anOpsSession`); nový `src/document/snapshot-document.ts`, `src/document/index.ts`, `src/document/testing.ts` (`aSnapshotDocument`); `src/interaction/feature-dialog/feature-editor.ts`, volající portů v `src/interaction` (`feature-tree.ts`, `browser-model.ts`, `document-name.ts`, `builtin-actions.ts` – jen `void`/typy); `src/app/remote-dispatcher.ts` (přepis), `src/app/mirror-document.ts` (smazat), `src/app/remote-session.ts`, `src/app/read-only.ts`, `src/app/remote-registries.ts` (bez `handlers`). Testy: `test/unit/app/remote-dispatcher.test.ts` (přepis), `test/unit/app/mirror-document.test.ts` → `test/unit/document/snapshot-document.test.ts`, `test/unit/app/remote-session.test.ts`, `test/unit/app/read-only.test.ts`, `test/unit/app/remote-registries.test.ts`, `test/unit/interaction/feature-dialog/feature-editor.test.ts` (na `FakeOps`), ostatní testy `interaction`/`sketcher` jen tolik, aby prošly s přechodovým `anOpsSession`.
- **Kontrakt – porty (`ops/ports.ts`):**

```ts
export interface DispatchMeta {
  /** Výchozí: op.type. */
  readonly label?: string;
}

export interface OperationDispatcher {
  /**
   * Pošle operaci jako jeden záznam logu. true = server ji přijal (dokument už ukazuje read model
   * odpovědi), false = odmítl (hlášení ukáže app). Během transakce vyhodí hned (chyba programátora).
   */
  dispatch(op: Operation, meta?: DispatchMeta): Promise<boolean>;
  /** Zahájí transakci hned (BeginTransaction jde frontou). Jen jedna; druhý begin vyhodí. */
  begin(label: string): Transaction;
  readonly inTransaction: boolean;
}

export interface Transaction {
  readonly label: string;
  apply(op: Operation): Promise<boolean>;
  /** Na serveru se vrátí při commitu i abortu, do logu nejde (spec 04, Q018). */
  applyTransient(op: Operation): Promise<boolean>;
  /** Ukončí transakci hned (inTransaction = false); server zapíše nejvýš jeden záznam. */
  commit(): Promise<boolean>;
  abort(): Promise<boolean>;
}

export interface UndoManager extends Disposable {
  /** Zásobník undo serveru není prázdný a neběží transakce. */
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  /** Jen při změně dvojice (canUndo, canRedo). */
  readonly events: Subscribable<{ changed: { canUndo: boolean; canRedo: boolean } }>;
}
```

  `LogEntry`, `DispatchMeta.kind/target`, `OperationDispatcher.events` a `UndoManager.stacks` z portů zmizí (N163). Ukončená transakce: další volání vyhodí (jako dnes); ztracená transakce: no-op vracející `Promise.resolve(false)`.

- **Kontrakt – snímkový dokument (`document/snapshot-document.ts`, N165):**

```ts
export interface DocumentSnapshot {
  readonly meta: DocumentMeta;
  readonly studio: PartStudioData;
}

export interface SnapshotDocument {
  /** Čtecí pohled pro všechny; samostatný objekt, takže přetypování AppSession.doc nedosáhne na replace. */
  readonly reader: DocumentReader;
  /**
   * Nahradí snímek. Featura stejná jako zobrazená (hluboká rovnost JSON) zůstane týž objekt,
   * stejně tak bodies a celé studio; changed jen při skutečné změně meta nebo studia.
   */
  replace(next: DocumentSnapshot): void;
}

export function createSnapshotDocument(initial: DocumentSnapshot): SnapshotDocument;
```

  - `reader.feature`, `indexOf`, `bodyMeta` čtou snímek (`bodyMeta` bez metadat = jeden sdílený zmrazený `{}`, jako dnes). Snímek i pole jsou zmrazené.
  - `replace` se jménem beze změny studia vyšle `changed` s nezměněným `studio` (pravidlo `DocumentEvents`).
  - Test builder (`document/testing.ts`): `aSnapshotDocument(options?: DocumentOptions): TestDocument`, kde `TestDocument extends DocumentReader { replace(next: { readonly name?: string; readonly studio?: PartStudioData }): void }`. Starý `aDocument` zůstává do úkolu 3 (potřebuje ho přechodový dvojník).

- **Kontrakt – `FakeOps` (`ops/testing.ts`, N166):**

```ts
export type SentChange =
  | { readonly kind: 'dispatch'; readonly op: Operation; readonly label?: string }
  | { readonly kind: 'begin'; readonly label: string }
  | { readonly kind: 'apply' | 'applyTransient'; readonly op: Operation }
  | { readonly kind: 'commit' | 'abort' | 'undo' | 'redo' };

export interface FakeAnswer {
  /** Výchozí true. */
  readonly ok?: boolean;
  /** Read model odpovědi: dokument se nahradí dřív, než se slib vyřeší (jako RemoteSession). */
  readonly document?: { readonly name?: string; readonly studio?: PartStudioData };
}

export interface FakeOpsOptions extends DocumentOptions {
  readonly canUndo?: boolean;
  readonly canRedo?: boolean;
}

/** OperationDispatcher pro testy interaction a sketcher: nic neaplikuje, jen zaznamená a čeká. */
export interface FakeOps extends OperationDispatcher {
  readonly doc: TestDocument;
  readonly undo: UndoManager & { setFlags(flags: { canUndo: boolean; canRedo: boolean }): void };
  /** Všechny odeslané změny v pořadí. */
  readonly sent: readonly SentChange[];
  /** Jen operace (dispatch, apply, applyTransient) v pořadí, dávky nerozbalené. */
  ops(): readonly Operation[];
  /** Parametry posledního feature.setParams nebo feature.add dané featury; undefined = žádné. */
  lastParams(featureId: FeatureId): unknown;
  /** Kolik změn čeká na odpověď. */
  readonly unanswered: number;
  /** Odpoví nejstarší čekající změně; bez čekající vyhodí. */
  answer(result?: FakeAnswer): void;
  /** Odpoví všem čekajícím stejně (dokument se nahradí jednou, před prvním slibem). */
  answerAll(result?: FakeAnswer): void;
}

export function aFakeOps(options?: FakeOpsOptions): FakeOps;
```

  - Výchozí: **odpověď nepřijde, dokud ji test nepošle** – rozpracované hodnoty dialogu jsou pak pravda a testy nástrojů skicáře čtou stav session beze změny.
  - Stráže jako skutečný dispečer: `dispatch` a `begin` během transakce vyhodí; volání ukončené transakce vyhodí.
  - **Přechodový `anOpsSession`** (jen do úkolu 3): dnešní tvar `{ doc, handlers, log, dispatcher, undo }`, `dispatcher`/`undo` = adaptér nového portu nad starým paměťovým dispečerem (změnu aplikuje synchronně a vrátí `Promise.resolve(true)`). Testy, které poslouchají `dispatcher.events.on('applied')` (`feature-editor.test.ts`, `sketch-editor.test.ts:182`, `sketch-session.test.ts:127`), přejdou na `log`, `doc` nebo `FakeOps.ops()`.

- **Kontrakt – rozpracované hodnoty (`feature-editor.ts`, N164):** veřejné typy `FeatureEditor`, `FeatureEditSession`, `EditState`, `FieldState` beze změny tvaru; mění se význam `EditState.params` a `name`:

```ts
// uvnitř createSession – jen stav, žádné nové veřejné API
let draft: { params: Readonly<Record<string, unknown>>; name: string | null } | null; // create: počáteční featura
let lastSent = 0;          // pořadí posledního odeslání této session
function send(op: Operation, step: (op) => Promise<boolean>): void {
  const n = ++lastSent;
  void step(op).then((ok) => { if (open && ok && n === lastSent) { draft = null; refresh(); } });
}
// readParams(prev) = draft?.params ?? doc.feature(featureId)?.params ?? prev?.params ?? {}
// readName(prev)   = doc.feature(featureId)?.name ?? draft?.name ?? prev?.name ?? ''
```

  - `applyPatch`: nové parametry `{ ...readParams(), ...patch }` → `draft = { params, name }` → `refresh()` **před** odesláním (stav je hned vidět) → `send(op, tx.apply)`. Shodné hodnoty → nic (dnešní pravidlo).
  - `create`: `draft` = parametry a jméno nové featury, `feature.add` jde přes `send` (jeho přijetí také ruší `draft`); `edit`: `draft = null`, čte dokument; přechodný posun baru přes `tx.applyTransient` bez `send` (rozpracované hodnoty se ho netýkají).
  - `commit`/`cancel`: session se zavře hned (`tx.commit()`/`tx.abort()` ukončí transakci synchronně); pozdní odpovědi nic nemění (`open` = false). `closeAfter` zůstává.
  - `doc.events.changed` dál vyvolá `refresh` (jména v čipech); s `draft` se parametry nemění.
  - **Invarianty:** (a) `EditState.params` nikdy neukáže odpověď na jinou než poslední odeslanou změnu session; (b) dvě rychlé změny různých parametrů → druhý `feature.setParams` nese obě hodnoty; (c) po přijetí poslední změny `params` = parametry featury v dokumentu (read model); (d) odmítnutá poslední změna nechá `draft`.
  - **Krajní případy:** odmítnutý `feature.add` v `create` → `draft` zůstane, featura v dokumentu není, OK pošle `Commit` (server vrátí prázdný nebo `NO_TRANSACTION`, dialog je zavřený); dokument se mění zvenku (undo je během transakce zakázané, druhá karta nepíše) – při `draft` vyhrává `draft`, bez něj dokument; featura z dokumentu zmizí (ztracená transakce) – `prev` jako dnes.

- **Kontrakt – tenký dispečer (`app/remote-dispatcher.ts`, N163, N167):**

```ts
export interface RemoteDispatcherDeps {
  readonly session: Pick<RemoteSession, 'readModel' | 'events' | 'change'>;
  /** Odmítnutá změna (RemoteError): app → connection.changeDropped + noticeOfRefusal. Jednou na objekt chyby. */
  readonly onError: (error: Error) => void;
  /** Transakce na serveru skončila (událost lost, odmítnutý begin, NO_TRANSACTION u kroku). */
  readonly onLost: () => void;
}
export type RemoteDispatcherHandle = OperationDispatcher & Disposable & { readonly undo: UndoManager };
export function createRemoteDispatcher(deps: RemoteDispatcherDeps): RemoteDispatcherHandle;
```

| Volání | Požadavek | Přijato | Odmítnuto |
|---|---|---|---|
| `dispatch(op, meta)` | `{ kind: 'dispatch', op, label? }` | `true` | `onError`, `false` |
| `begin(label)` | `{ kind: 'begin', label }` | – | `onError`, transakce ztracená (`onLost`) |
| `tx.apply` / `applyTransient` | `apply` / `applyTransient` | `true` | `NO_TRANSACTION` → ztracená (`onLost`), jinak `onError`; `false` |
| `tx.commit()` | `commit` | `true` | `NO_TRANSACTION` → `onError`, `false`; jiná → `onError` + `{ kind: 'abort' }` best effort (jeho `NO_TRANSACTION` se ignoruje), `false` |
| `tx.abort()` | `abort` | `true` | `NO_TRANSACTION` ignorovat; jiná → `onError`; `false` |
| `undo.undo()` / `redo()` | `undo` / `redo` | `true` | `onError`, `false` |
| událost sezení `lost` | – | – | otevřená transakce ztracená, `onLost` |

  - `canUndo` = `readModel.session.canUndo && tx === null`; `changed` při změně read modelu a při začátku/konci transakce. `undo()` bez `canUndo` vyhodí (chyba programátora, jako dnes).
  - Žádný dokument, žádné handlery, žádné přestavění; `dispose` odpojí odběry a pozdní odpovědi vyřeší `false` bez `onError`. Odmítnutí slibu `session.change` (jen po `dispose` sezení) → `false`.
  - **`remote-session.ts`:** `const document = createSnapshotDocument(snapshotOf(readModel.document))` a odběr `session.readModel` → `document.replace(…)` zaregistrovat **před** `createRemoteDispatcher`; `doc = document.reader`. `snapshotOf` = `{ meta: { id, name, createdAt }, studio }`. `remote-registries.ts` bez `handlers` (a bez importu `ops`). `read-only.ts`: `refuseChanges` a `refuseUndo` podle nových portů (vyhodí synchronně, jako dnes).
- **Testy (větší celky):**
  - `snapshot-document.test.ts`: čtení, `replace` se sdílením featur a `bodies`, `changed` jen při změně, přejmenování, `reader` není `SnapshotDocument` (žádné `replace`).
  - `remote-dispatcher.test.ts` nad falešným `RemoteSession` (`src/remote/testing.ts`, jako dnes): každý řádek tabulky; dvě `apply` → obě odeslané v pořadí, slib každé se vyřeší; `onError` jednou pro sloučenou dvojici; `lost` uprostřed transakce → kroky no-op, `onLost`; `canUndo` během transakce false; `dispose`.
  - `remote-session.test.ts` nad `createFakeCore()`: dialog vytvoří featuru → featura je v `doc` až s odpovědí; **slib změny se vyřeší až po `doc.replace`** (invariant N165); `SKETCH_NOT_SOLVED` nechá v dialogu lokální skicu a hlášení (dnešní test M48 přepsaný z vrstvy zrcadla na rozpracované hodnoty); `STORAGE` u `Commit` → hlášení a odeslaný `Abort`, další `dispatch` uspěje.
  - `feature-editor.test.ts` na `FakeOps`: invarianty (a)–(d), `create` (odeslané `begin` + `apply(feature.add)`, stav z `draft`), `edit` s posunem baru (`applyTransient`), `commit`/`cancel` zavřou hned, pozdní odpověď po zavření nic, ostatní dnešní případy (validace, viditelnost, čipy, fokus) převést na `sent` a `state` místo `doc`/`log`. Případy, které testovaly jen paměťový dispečer (sloučení v logu, `applied`), smazat.
- **Hotovo když:** testy výše zelené, `rg -n "MirrorDocument|applyOperation" src/app` nic, `npm run check` zelený (ostatní testy `interaction`/`sketcher` běží přes přechodový `anOpsSession`).

### 2. Testy `interaction` a `sketcher` na `FakeOps`

- **Soubory (jen `test/`):** 37 souborů, které importují `anOpsSession` (`grep -rl anOpsSession test`), kromě `test/unit/ops/*` (smaže úkol 3) a těch, které už převedl úkol 1. Volitelně pomůcka v `src/interaction/testing.ts`: `aFeatureEditorSetup({ schemas, ...DocumentOptions }) → { ops: FakeOps, doc, editor }`, pokud ji používá víc než pět souborů (jinak ne).
- **Pravidla převodu:**
  - Nastavení: `anOpsSession({ schemas, features })` → `aFakeOps({ features })` (schémata už dvojník nepotřebuje – nic nemigruje); `ops.doc` → `ops.doc`, `ops.dispatcher` → `ops`.
  - Aserce na výsledný dokument po příkazu (`doc.feature(id).name`, `doc.bodyMeta(b).color`) → aserce na odeslanou operaci (`ops.sent` / `ops.ops()`); aserce, kde model reaguje na **změnu dokumentu** (řádky stromu, čipy, Prohlížeč) → `ops.doc.replace({ studio })` v testu (skriptovaný read model).
  - Testy skicáře čtou stav session (rozpracované hodnoty); `docEntity(doc, id)` a `docConstraints(doc)` → `ops.lastParams(featureId)`; `log.entries()` po Hotovo → `ops.sent` končí `commit` a poslední `setParams` nese očekávaná data. „Jeden záznam v logu“ už klient netvrdí (slučuje server, spec 04) – test ověří jeden `begin` a jeden `commit`.
  - Testy undo/redo (`builtin-actions`, `history-model`): `ops.undo.setFlags(…)` a `sent` obsahuje `undo`.
  - Test, který ověřoval jen chování paměťového dispečera, se smaže; počet smazaných případů uvést v hlášení.
- **Hotovo když:** `rg -n "anOpsSession|createOperationLog|handlers" test/unit/interaction test/unit/sketcher` nic, `npx vitest run test/unit/interaction test/unit/sketcher` zelené, `npm run check` zelený.

### 3. Mazání handlerů a měnitelného modelu

- **Soubory:** smazat `src/ops/{apply,handler,op-handler,errors,dispatcher,transaction,log,undo}.ts` a `src/ops/handlers/`; `src/ops/index.ts` (jen typy operací, `OP_VERSION`, typy portů), `src/ops/testing.ts` (jen `FakeOps`, přechodový `anOpsSession` pryč); smazat `src/document/{cad-document,serialize}.ts` a z `document.ts` typ `DocumentWriter`; `src/document/index.ts`, `src/document/testing.ts` (`aDocument`, `fromData`, `toData`, `bodyId`?, `ORIGIN_AXIS_IDS`? – ponechat jen to, co testy po úkolu 2 používají; `aSnapshotDocument` zůstává); smazat `test/unit/ops/{apply,dispatcher,handler,log,transaction,undo}.test.ts` a `test/unit/ops/handlers/`, `test/unit/document/{cad-document,serialize}.test.ts` a dotčené části `document.test.ts`/`index.test.ts`; smazat `test/integration/shared-cases/ops.test.ts` a upravit `coverage.test.ts` jen tam, kde vyžaduje TS běžce `ops` (případy `test/shared-cases/ops/` zůstávají pro C++); `.dependency-cruiser.cjs` (pravidla, která zmiňují smazané soubory), `knip`/ESLint konfigurace, pokud je zmiňují.
- **Kontrakt:** veřejné API `ops` = typy `Operation` a všech operací, `OP_VERSION`, typy `DispatchMeta`, `OperationDispatcher`, `Transaction`, `UndoManager`. Veřejné API `document` = dnešní bez `createDocument`, `DocumentWriter`, `migrateFeatureData`, `DocumentLoadError`, `DocumentLoadIssue`, `FeatureData` (pokud je po smazání nic v `src` nepoužívá) + `createSnapshotDocument`, `DocumentSnapshot`, `SnapshotDocument`. Tabulka modulů v `.dependency-cruiser.cjs` se nemění (`ops` dál smí `core`, `document`).
- **Testy:** `test/unit/ops/operation.test.ts` a `index.test.ts` (veřejné API) upravit; `test/unit/document/index.test.ts` (veřejné API) upravit.
- **Hotovo když:** akceptační `rg` a `ls` z [[#Akceptační kritéria]] platí, `npm run check` zelený, v hlášení počet smazaných řádků (`git diff --stat`).

### 4. Jeden toast a hlášení undo

- **Soubory:** `src/ui/App.vue`, `src/ui/components/AppShell.vue`, `src/ui/toasts.ts` (jen pokud je potřeba spojit položky), `src/app/notices.ts`; testy `test/unit/ui/toasts.test.ts`, `test/unit/app/notices.test.ts`.
- **Kontrakt (N170):** `AppShell` dostane prop `closeToasts: readonly ToastItem[]` a událost `dismiss-close`; kreslí jediný `ToastStack` s `[...closeToasts, ...toasty hlášení]`. `App.vue` kreslí vlastní `ToastStack` jen ve větvi bez sezení (seznam dokumentů). **N169:** `noticeOfRefusal` → `null` pro `RemoteError` s `reason` `NOTHING_TO_UNDO` a `NOTHING_TO_REDO`.
- **Testy:** řádky tabulky `noticeOfRefusal` pro oba důvody; presenter spojení položek (pořadí: chyba zavření první), SSR `AppShell` s chybou zavření jen jeden kontejner toastu, pokud to jde bez velkého stubování (jinak jen presenter).
- **Hotovo když:** `rg -n "<ToastStack" src/ui` najde `AppShell.vue` a jednu větev `App.vue`, `npm run check` zelený.

### 5. E2E po M52 a bundle

- **Soubory:** `test/e2e/m46-latency.spec.ts`, `test/e2e/m46-outage.spec.ts` (komentáře bez zrcadla, aserce níže), nový `test/e2e/m52-thin-client.spec.ts`; `test/e2e/helpers.ts` jen pro sdílenou pomůcku (`delayUnaryCalls` přesunout z `m46-latency` do helperu, když ji používají dva soubory).
- **Co musí e2e tvrdit po M52:**
  - `m46-latency` (150 ms): tažení šipky – po puštění zůstane v poli poslední hodnota **i po 1 s** (poll, že se nezmění, ne jen jedna kontrola po „Uloženo“) a v historii jeden záznam; tažení bodu skici – beze změny smyslu; rychlé úpravy pole – beze změny smyslu. Komentář hlavičky: dialog drží rozpracované hodnoty, ostatní čeká na odpověď (N164, N168).
  - `m46-outage`: beze změny scénáře; navíc po obnovení spojení pole drží hodnotu puštění dřív, než přijde „Uloženo“ (rozpracované hodnoty nepřepíše odpověď na starší krok).
  - `m52-thin-client` (150 ms): (a) přejmenování featury ve Timeline → nové jméno se objeví (bez pevného čekání), v historii záznam, po reloadu jméno platí; (b) dvakrát rychle Ctrl+Z po dvou změnách → obě vrácené, žádný toast (N169); (c) změna barvy tělesa v Prohlížeči → barva po odpovědi, po reloadu platí. Konzole bez chyb (fixture beze změny).
- **Bundle:** `npm run build` před úkolem 1 (commit `main` s M48+M49) a po úkolu 4; zapsat `dist/` syrově a gzip a největší chunk JS (stejná metoda jako [[M47-uklid-a-dokonceni|M47]], tabulka v retrospektivě).
- **Hotovo když:** `npm run test:e2e -- m46 m52` zelené dvakrát po sobě, `npm run test:e2e:full` zelené (Chrome, WebKit, `restart`), čísla bundlu v hlášení.

### 6. Specifikace (hlavní sezení)

- [[01-architektura]]: prstenec 1 `ops` = typy a porty; diagram vrstev (`app` bez zrcadla, `ops` bez handlerů, `document` snímky read modelu); **Tok dat jedné změny** přepsat (rozpracované hodnoty v dialogu, dokument až z odpovědi); zákaz o paměťovém dvojníku nahradit `FakeOps`; pravidlo `sketcher-ops-only-in-tests` ověřit.
- [[03-dokument]]: v klientovi jen čtecí pohled `createSnapshotDocument`; `DocumentWriter` a mutátory jsou kontrakt C++ (`server/src/document`); poznámka k [[0011-programovani-proti-rozhranim|ADR 0011]].
- [[04-operace-a-historie]]: odstavec „Kde běží“ (klient = typy a porty), nové porty (N163), sekce Testy (TS jen `OP_VERSION` a `FakeOps`).
- [[10-interakce]]: `FeatureEditor` – rozpracované hodnoty a pravidlo „poslední vyhrává“, `EditState.params`, commit/cancel zavřou hned, odmítnutí; strom, Prohlížeč a jméno dokumentu – změna viditelná s odpovědí; `SketchSession` – data z rozpracovaných hodnot (N172); Testy – `FakeOps`.
- [[11-ui]]: `AppSession.doc` (snímky read modelu), tabulka modulů (`mirror-document.ts` pryč, `remote-dispatcher.ts` tenký, N167), kroky sestavení, hlášení (N169), `ToastStack` jediný (N170), odezva bez optimismu (N168).
- [[13-testovani]]: TS běžci sdílených případů `sketch` a `schema`; `ops.script` jen C++ (N166).
- [[14-protokol]]: Změny dokumentu – skica bez „zrcadla“ (rozpracované hodnoty), `STORAGE` u `Commit` → klient pošle `Abort` (N167), tažení a „poslední vyhrává“ podle N164.
- [[0031-tenky-klient-bez-handleru|ADR 0031]]: do Důsledků odkaz na upřesnění N163–N172.
- Pojem **Rozpracované hodnoty dialogu** v `50-pojmy/` (`/zaznam pojem`), odkaz z [[Transakce]] a [[Read model]].

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_Návrh Clauda (stopa B)._

- Klient nemá handlery operací, `applyOperation` ani měnitelný dokument: dokument je snímek read modelu, jediný lokální stav změn jsou [[Rozpracované hodnoty dialogu|rozpracované hodnoty dialogu]] (N164). Z kódu interakcí se měnil jen editor featur; skicář a manipulátory beze změny díky `FeatureEditSession`.
- Dočasný adaptér v úkolu 1 držel `npm run check` zelený po každém úkolu; ~33 testových souborů přešlo na `FakeOps`.
- E2E odhalily ztrácení rozepsaného textu v panelu skici (watch na nové pole při každém snímku – po M52 častější, N177) a nestabilní e2e restartu z M48 (povolená 503 na `WatchSession`).
- Odchylka od plánu: typy chyb importu (`DocumentLoadError`/`Issue`) zůstaly v `load-error.ts`, kód i spec 03 jim odpovídají.
- Výsledek: −2 578 řádků src, −4 865 testů; `check:full` (5420 unit, 315 integračních, server) a `test:e2e:full` 213/213 zelené. Bundle téměř beze změny (2,68 MB gzip) – handlery byly malé, přínos je v jednodušším modelu.
