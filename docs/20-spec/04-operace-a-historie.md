---
type: spec
status: implemented
order: 4
aliases:
  - ops – operace, log, undo/redo
  - Spec 04
modules:
  - ops
milestones:
  - "[[M03-operace]]"
  - "[[M12-skicar]]"
  - "[[M15-export-a-dokonceni]]"
tags:
  - spec
created: 2026-10-12
updated: 2026-10-14
---
# 04 – `ops`: operace, log a undo/redo

> **Pojmy:** [[Operace]], [[Handler operace]], [[Operační log]], [[Transakce]], [[Undo a redo]], [[Determinismus operací]]  
> **Rozhodnutí:** [[0005-operacni-log]], [[Q005 Komprese transakce add a setParams|Q005]], [[Q029 Posun rollback baru při změnách featur|Q029]], [[Q030 Výjimka odběratele po změně dokumentu|Q030]], [[Q031 Inverze dávky operací|Q031]]  
> **Milník:** [[M03-operace]]

Jediná cesta, jak změnit dokument. Každá změna je **operace** – serializovatelný popis (data). Operace se aplikují přes dispečera a zapisují do **neměnného logu**. Undo/redo, ukládání i případná budoucí synchronizace stojí na tomto logu ([[0005-operacni-log|ADR 0005]]). Závisí na `core` a `document`.

**Hlavní invariant:** přehrání logu od prázdného dokumentu dá přesně živý dokument. Všechna pravidla níže slouží jemu.

## Operace

```ts
export interface Operation {
  readonly type: string;   // 'feature.add'
  readonly v: number;      // verze schématu této operace, celé číslo ≥ 1
}
```

Payload je **přímo na objektu operace** (žádné vnořené `payload`), např. `{ type: 'feature.rename', v: 1, featureId, name }`. Operace je čistý JSON a je neměnná (typy `readonly`; dispečer ji nekopíruje ani nemrazí).

### Sada operací

Typů je záměrně málo a jsou malé: log žije navždy, každá změna tvaru operace znamená migraci. Všechny mají v M3 `v: 1`; `feature.setParams` má od [[M10.1-zpevneni-kostry|M10.1]] `v: 2` (`upcast` z 1 doplní `typeVersion: 1`, [[Q035 Migrace featur v záznamech logu|Q035]]).

| `type` | Pole (kromě `type`, `v`) | Inverze (spočítaná z aktuálního stavu) | Mutátor |
|---|---|---|---|
| `feature.add` | `feature: FeatureInstance, index: number` | `feature.remove { featureId: feature.id }` | `insertFeature` |
| `feature.remove` | `featureId` | `feature.add` s aktuální instancí a jejím indexem | `removeFeature` |
| `feature.setParams` (`v: 2`) | `featureId, typeVersion: number, params: unknown` (celé nové parametry a verze schématu, se kterou vznikly) | `feature.setParams` s aktuálními `typeVersion` a parametry | `replaceFeature({ ...f, typeVersion, params })` po migraci |
| `feature.rename` | `featureId, name: string` | `feature.rename` s aktuálním jménem | `replaceFeature({ ...f, name })` |
| `feature.suppress` | `featureId, suppressed: boolean` | `feature.suppress` s aktuální hodnotou | `replaceFeature({ ...f, suppressed })` |
| `feature.move` | `featureId, toIndex: number` | `feature.move` na aktuální index | `moveFeature` |
| `studio.setRollback` | `index: number` | `studio.setRollback` na aktuální index | `setRollbackIndex` |
| `body.rename` (M11) | `body: BodyId, name: string` (`''` = smazat jméno) | `body.rename` s aktuálním jménem nebo `''` | `setBodyMeta(body, { ...aktuální, name })` |
| `body.setVisible` (M11) | `body: BodyId, visible: boolean` | `body.setVisible` s aktuální viditelností (`!hidden`) | `setBodyMeta(body, { ...aktuální, hidden: visible ? undefined : true })` |
| `body.setColor` (M15) | `body: BodyId, color: string \| null` (`'#rrggbb'` malými písmeny, `null` = výchozí barva) | `body.setColor` s aktuální barvou nebo `null` | `setBodyMeta(body, { ...aktuální, color: color ?? undefined })` |
| `batch` | `ops: readonly Operation[]` | viz [[#Dávka]] | – |

Modul exportuje typy `FeatureAddOp`, `FeatureRemoveOp`, `FeatureSetParamsOp`, `FeatureRenameOp`, `FeatureSuppressOp`, `FeatureMoveOp`, `StudioSetRollbackOp`, `BodyRenameOp`, `BodySetVisibleOp`, `BodySetColorOp` (M15), `BatchOp`. Konstruktory operací nejsou – operace je literál.

`setParams` nese **celé** parametry, ne patch. Inverze je pak triviální a operace nezávisí na předchozím stavu.

Operace `body.*` (M11) mění [[03-dokument#Metadata těles|metadata těles]]. Mají `v: 1`, nemají `merge` ani `upcast`, existenci tělesa nekontrolují (dokument tělesa nezná) a rollback bar nemění, takže je `applyOperation` neobaluje. Jdou do logu i undo jako každá jiná změna dokumentu ([[Rozhodnutí noční rychloakce#M11 – Další entity|R13]] ⚠).

`feature.rename` přejmenuje **featuru**. Přejmenování dokumentu (`DocumentWriter.rename`) zatím operaci nemá; přibude jako nový typ, až ho bude potřebovat UI.

Skicář vlastní operace v M12 **nemá**: editace skici je `feature.setParams` s celými vyřešenými daty skici v jedné transakci, takže je v logu jeden záznam ([[Q074 Operace skicáře v logu|Q074]], [[12-skicar#Operace a transakce]]). Kdyby operace pluginu někdy přibyly, registrují se jako featury (`FeaturePlugin.ops`). `validate` operace `feature.add` od M12 odmítne i `FeatureId` `'origin'` (vyhrazený vlastník počáteční geometrie, [[03-dokument#Počáteční geometrie (M12)]]).

## Handler

```ts
export interface OpHandler<O extends Operation = Operation> {
  readonly type: string;
  readonly version: number;
  /** Spočítá inverzi z AKTUÁLNÍHO stavu – volá se PŘED apply. Nesmí nic měnit. */
  invert(doc: DocumentReader, op: O): Operation;
  /** Aplikuje změnu. Musí být deterministická: žádný Date.now, Math.random, nová ID. */
  apply(doc: DocumentWriter, op: O): void;
  /** Volitelné: sloučí dvě po sobě jdoucí operace (např. dvě setParams téže featury). */
  merge?(prev: O, next: O): O | null;
  /** Převod starší verze operace na aktuální při načítání logu. */
  upcast?(fromVersion: number, raw: unknown): O;
  /** Kontrola tvaru payloadu operace aktuální verze při načítání (obálka už je ověřená). Prázdné pole = v pořádku. */
  validate?(raw: Readonly<Record<string, unknown>>): readonly OperationLoadError[];
}

export type OpHandlerRegistry = Registry<OpHandler>;   // klíč = type, viz core
/** Registr s vestavěnými handlery (feature.*, studio.setRollback, od M11 body.*). register({ type: 'batch' }) vyhodí. Schémata potřebuje migrace dat featur při apply. */
export function createOpHandlerRegistry(deps: { schemas: RegistryReader<FeatureSchema> }): OpHandlerRegistry;
```

Kontrakt handleru:
- `invert` na neexistující featuru (`featureId` není v dokumentu) **vyhodí** – je to chyba volajícího. Protože `invert` běží před `apply`, dokument zůstane beze změny.
- `apply` kontroly invariantů nedělá sám, nechává je na mutátorech dokumentu ([[03-dokument|spec 03]]), které při porušení vyhodí a nic nezmění.
- Inverze má `v` rovné aktuální verzi **handleru svého typu** (inverze `feature.add` je `feature.remove` ve verzi handleru `feature.remove`). Verze každého typu operace je proto jedna konstanta, kterou sdílí handler i každý, kdo operaci toho typu vytváří. Vestavěné verze jsou v `OP_VERSION` (objekt `typ → verze`), který `ops/index.ts` exportuje pro tvůrce operací mimo `ops` (`interaction`, dev stránky); vlastní operace pluginu (M12) mají verzi u svého handleru.
- Handler se o [[Rollback bar|rollback bar]] nestará – viz [[#Dávka a rollback bar]].
- `merge(prev, next)` vrací operaci `m`, pro kterou platí: aplikace `m` na stav před `prev` = aplikace `prev` a pak `next`, a `prev`ova inverze z `m` vrátí stav před `prev`. Jinak vrací `null`. V M3 ho má jen `feature.setParams`: stejné `featureId` → `next`, jinak `null`.

### Migrace dat featur

Operace `feature.add` a `feature.setParams` nesou parametry featury i s verzí schématu (`feature.typeVersion`, resp. `typeVersion`). Log žije navždy, takže po zvednutí verze schématu nesou staré záznamy stará data. Handlery je převedou **při `apply`** přes `migrateFeatureData` z [[03-dokument#Migrace dat featur|document]] ([[Q035 Migrace featur v záznamech logu|Q035]]): `feature.add` vloží migrovanou featuru, `feature.setParams` nastaví `{ ...f, ...migrované({ type: f.type, typeVersion: op.typeVersion, params: op.params }) }`. `err` z migrace je výjimka handleru (dokument beze změny; při přehrání logu z ní `loadDocument` udělá chybu `entry`). `invert` nese aktuální `typeVersion` a parametry featury, takže inverze už je v aktuální verzi. Featura neznámého typu (bez schématu) převezme `typeVersion` z operace beze změny parametrů.

Determinismus platí: migrace je čistá funkce schématu a dat a schémata jsou pro běžící aplikaci konstantní. Přehrání od základu a snapshot + zbytek dávají totéž, protože `fromData` migruje stejnou funkcí. `parseLogEntry` zůstává bez schémat a bez stavu.

**Invariant:** verze operace nesoucí data featury se zvedá dřív, než první schéma opustí verzi 1 – jen tak smí `upcast` ze starší verze operace doplnit chybějící `typeVersion: 1`.

### Determinismus

Přehrání logu na prázdném dokumentu musí vést k **přesně** stejnému dokumentu. Proto:
- všechna ID (nová featura, nové jméno) se generují **před** vytvořením operace a jsou v payloadu,
- `apply` nesmí číst čas, náhodu ani nic mimo dokument a operaci,
- čas je jen metadata záznamu logu, do dokumentu se nepropisuje.

Ověřuje to property-based test (viz [[13-testovani|13]]).

## Dávka a rollback bar

Obě obecná pravidla řeší **jedna interní funkce** `applyOperation(doc, handlers, op): { inverse: Operation; deferred: unknown[] }` (inverze a odložené výjimky odběratelů, viz níže). Sdílí ji `dispatch`, transakce i `replayLog`, takže se nikde nemůžou rozejít ([[Q031 Inverze dávky operací|Q031]]).

### Dávka

`batch` **nemá handler v registru** – je to strukturální operace, ne doménová. Inverzi dávky nejde spočítat předem (inverze druhé podoperace závisí na stavu po první), proto ji `applyOperation` sbírá postupně:

1. Podoperace se aplikují v pořadí, každá rekurzivně přes `applyOperation` (vnořené dávky jsou dovolené).
2. Inverze dávky = `batch` inverzí podoperací v **opačném** pořadí, `v: 1`.
3. Prázdná dávka nic nezmění a její inverze je prázdná dávka.
4. **Atomičnost:** když podoperace selže (handler vyhodí a dokument se nezměnil), už aplikované podoperace se vrátí jejich inverzemi v opačném pořadí a původní výjimka letí dál. Pokud se během dávky nebo vracení objevily i další výjimky (odložené výjimky odběratelů, selhání vracení), letí `AggregateError` v pořadí: původní výjimka, odložené výjimky podoperací, chyby při vracení.

### Rollback bar

Mutátory posouvají rollback bar při vložení, smazání a přesunu podle pravidel ze [[03-dokument|spec 03]], která nejsou přesně invertovatelná. Proto `applyOperation` u každé **nedávkové** operace kromě `studio.setRollback`:
- si před `apply` zapamatuje `rollbackIndex`,
- a pokud se po `apply` změnil `rollbackIndex` **nebo počet či pořadí featur** (porovnání posloupnosti `id`), vrátí jako inverzi `batch[inverze handleru, studio.setRollback(původní)]`.

Nestačí sledovat jen posun baru: index rovný `r` je v pravidlech dvojznačný, takže bar se při `apply` nemusí pohnout, a přesto ho posune až inverze (např. smazání featury na indexu `r` → inverzní vložení na `r` posune bar na `r + 1`). Bar se ale může posunout jen při strukturální změně seznamu featur, proto podmínka „změnilo se pořadí“ pokrývá všechny případy a `rename` či `setParams` zůstanou bez obalení.

U `studio.setRollback` by obalení bylo zbytečné (jeho inverze bar už obnovuje), proto se vynechává ([[Q029 Posun rollback baru při změnách featur|Q029]]).

### Výjimka odběratele

Mutátor může vyhodit výjimku **po** změně dokumentu (vyhodil ji odběratel `changed`, viz [[03-dokument|spec 03]]). `applyOperation` to pozná porovnáním identity `doc.studio` a `doc.meta` před a po ([[Q030 Výjimka odběratele po změně dokumentu|Q030]]):
- **beze změny** → selhání handleru: výjimka letí hned, nic se nezaznamená,
- **se změnou** → operace platí: inverze se spočítá normálně, výjimka se **odloží**. U dávky se pokračuje dalšími podoperacemi.

### Reentrance

Během `applyOperation` (tedy i v odběratelích `changed` dokumentu) je **zakázané** volat `dispatch`, `begin`, `Transaction.apply`, `commit`, `abort` i `undo`/`redo` – vyhodí. Vnořený záznam by se do logu zapsal dřív než vnější, ačkoli se aplikoval po něm, a replay by se rozešel. Kdo potřebuje na změnu reagovat další změnou, naplánuje ji až po dokončení (např. `queueMicrotask` v `app`). Odběratelé `appended`, `applied` a `transaction` volat smějí – záznam už je zapsaný.

Odložené výjimky vyhodí volající (dispečer, transakce) **až po zápisu** do logu nebo do transakce: jedna výjimka letí tak, jak je, víc jich letí jako `AggregateError` (stejně jako `Emitter` v [[02-core|core]]). Invariant: **log vždy odpovídá dokumentu.**

## Dispečer

```ts
export interface DispatchMeta {
  /** Výchozí: op.type. */
  readonly label?: string;
  /** Výchozí 'do'. 'undo' a 'redo' používá UndoManager. */
  readonly kind?: 'do' | 'undo' | 'redo';
  /** Povinné právě u 'undo' a 'redo': seq existujícího záznamu kind 'do'. */
  readonly target?: number;
}

export interface OperationDispatcher {
  /** Aplikuje operaci a zapíše ji do logu jako samostatný záznam. Během transakce vyhodí. */
  dispatch(op: Operation, meta?: DispatchMeta): LogEntry;

  /** Zahájí transakci – viz níže. Současně může běžet jen jedna, druhý begin vyhodí. */
  begin(label: string): Transaction;
  readonly inTransaction: boolean;

  readonly events: Subscribable<{
    /** Po každé aplikaci: dispatch a commit (entry); Transaction.apply, applyTransient, vracení přechodných kroků při commitu a abort (entry null). */
    applied: { entry: LogEntry | null; op: Operation };
    /** Transakce začala (true) nebo skončila commitem či abortem (false). */
    transaction: { active: boolean };
  }>;
}

export function createOperationDispatcher(deps: {
  doc: DocumentWriter;
  handlers: OpHandlerRegistry;
  log: OperationLog;
  /** Zdroj času pro LogEntry.time. Výchozí Date.now. */
  now?: () => number;
}): OperationDispatcher;
```

Průběh `dispatch(op, meta)`:
1. Kontrola: neběží transakce, `meta` je konzistentní (`target` právě u `undo`/`redo` a ukazuje na záznam `do`). Jinak výjimka a nic se nestane.
2. `inverse = applyOperation(doc, handlers, op)` – při selhání handleru se nic nezapíše a výjimka letí dál.
3. `entry = log.append({ kind, target, op, inverse, label, time: now() })` – výjimka odběratele `appended` se odloží, záznam platí
4. `emit('applied', { entry, op })` – výjimka odběratele se odloží
5. Vyhodí odložené výjimky, pokud nějaké jsou: odběratelů dokumentu z kroku 2, odběratelů `appended` z kroku 3 (záznam už v logu je) a odběratelů `applied` z kroku 4. Pořadí v `AggregateError` odpovídá pořadí kroků.

`dispatch` zapíše záznam i tehdy, když operace dokument nezmění (např. `setParams` se stejnými parametry). Detekce prázdných operací není potřeba.

`kind` a `target` jsou v `DispatchMeta` veřejné, protože je potřebuje `UndoManager`. Kdokoli jiný je používat nemá – dispečer jen hlídá, aby záznam byl konzistentní.

## Transakce

Dialog featury, tažení posuvníku nebo celé skicování nesmí v logu vytvořit stovky záznamů. Transakce aplikuje operace hned (dokument se mění, regenerace běží, uživatel vidí náhled), ale do logu zapíše **jeden** záznam až při potvrzení.

```ts
export interface Transaction {
  readonly label: string;
  apply(op: Operation): void;   // aplikuje okamžitě, zapamatuje si op + inverzi
  applyTransient(op: Operation): void; // aplikuje okamžitě, při commit i abort se vrátí, do logu nejde
  commit(): LogEntry | null;    // zapíše jeden záznam; prázdná transakce nezapíše nic
  abort(): void;                // aplikuje inverze v opačném pořadí, nezapíše nic
}
```

- `apply` jde přes `applyOperation`. Selže-li handler, transakce zůstane otevřená a beze změny, výjimka letí dál. Odložená výjimka odběratele letí až po zapamatování operace.
- **Přechodná operace** (`applyTransient`, [[Q018 Rollback bar při editaci starší featury|Q018]]): mění dokument jen po dobu transakce, typicky dočasný posun [[Rollback bar|rollback baru]] při editaci featury. Aplikuje se přes `applyOperation` jako `apply` (stejné chyby a události) a zapamatuje se s inverzí jako přechodný krok.
  - `commit` nejdřív vrátí přechodné kroky jejich inverzemi v opačném pořadí (každá vyšle `applied` s `entry: null`) a teprve pak komprimuje a zapíše ostatní kroky. Přechodné kroky do záznamu nejdou.
  - `abort` vrací všechny kroky (logované i přechodné) v opačném pořadí, jako dosud.
  - Kontrakt volajícího: přechodná operace musí **komutovat** s logovanými operacemi transakce, tj. přehrání záznamu bez ní dá stejný dokument. `studio.setRollback` vůči `feature.setParams` podmínku splňuje (parametry na pozici baru nezávisí). Transakce to neověřuje.
  - Transakce jen s přechodnými kroky je při commitu prázdná: nic nezapíše a vrátí `null`.
  - Selže-li při `commit` handler inverze přechodného kroku (chyba programátora, jako u `abort`), zbylé inverze se přeskočí, záznam se přesto zapíše, transakce se ukončí a výjimka letí na konci se sesbíranými. Dokument pak nesedí s logem.
  - Uvnitř transakce jsou přechodné kroky pro kompresi neviditelné: logované kroky kolem nich se můžou sloučit, jako by sousedily.
- `commit` operace zkomprimuje: **sousední** operace téhož typu, jejichž handler má `merge`, se zleva doprava zkusí sloučit (výsledek sloučení se zkouší slučovat s další). Sloučená operace si nechá inverzi té **první**. Pak:
  - 0 operací → nic nezapíše, vrátí `null`,
  - 1 operace → záznam s touto operací a její inverzí,
  - víc operací → záznam `batch[ops]` s inverzí `batch[inverze v opačném pořadí]`.
- Záznam má `kind: 'do'` a `label` transakce. Dokument se při commitu mění jen vrácením přechodných kroků. Pořadí: `log.append` → konec transakce (`transaction { active: false }`) → `applied` se záznamem. Odběratelé `applied` tak vidí stav po transakci, stejně jako u `dispatch`.
- Výjimky odběratelů `appended`, `transaction` i `applied` se při `commit` i `abort` sbírají do jednoho seznamu a letí až na konci (žádná nepřepíše jinou).
- `abort` aplikuje inverze v opačném pořadí přes `applyOperation` (každá vyšle `applied` s `entry: null`). Dokument i log jsou pak beze změny. Výjimky odběratelů během abortu se sesbírají a vyhodí až na konci, transakce se ukončí i tak.
- Po `commit` nebo `abort` je transakce ukončená. Další volání čehokoli na ní vyhodí. Konec transakce vyšle `transaction { active: false }`.
- `begin` je atomický: vyšle `transaction { active: true }`. Když odběratel vyhodí, dispečer transakci hned ukončí (`inTransaction` zpět na `false`, vyšle `transaction { active: false }`) a výjimky pošle dál. Transakce nevznikne a dispečer se nezablokuje.
- Selhání **handleru** inverze při `abort` je chyba programátora (inverze právě aplikované operace musí jít aplikovat). `abort` zbylé inverze přeskočí, transakci ukončí a výjimku pošle dál spolu s ostatními. Dokument pak zůstane částečně vrácený.

Komprese se omezuje na `merge` téhož typu ([[Q005 Komprese transakce add a setParams|Q005]]). Příklad – vytvoření kvádru přes dialog: `begin('Box')` → `feature.add` s výchozími parametry → 5× `feature.setParams` → `commit()`. Pět `setParams` se sloučí do jedné, v logu je jeden záznam `batch[feature.add, feature.setParams]`.

## Log

Log je **append-only**. Nic se z něj nemaže, ani při undo.

```ts
export interface LogEntry {
  readonly seq: number;              // 1, 2, 3, … v rámci dokumentu
  readonly kind: 'do' | 'undo' | 'redo';
  readonly target?: number;          // u undo/redo: seq původního 'do' záznamu
  readonly op: Operation;            // přesně to, co se aplikovalo
  readonly inverse: Operation;
  readonly label: string;            // 'Box 1: výška', zobrazí se v historii
  readonly time: number;             // ms epoch, jen metadata
}

/** Čtecí role logu (ADR 0011): UndoManager, persistence, UI historie. */
export interface OperationLogReader {
  /** Záznamy se seq ≥ fromSeq (výchozí 1), v pořadí. Kopie pole. */
  entries(fromSeq?: number): readonly LogEntry[];
  /** 0 u prázdného logu. */
  readonly lastSeq: number;
  readonly events: Subscribable<{ appended: LogEntry }>;
}

/** Zápisová role: append smí volat jen dispečer. */
export interface OperationLog extends OperationLogReader {
  /** Přidělí seq = lastSeq + 1, záznam zmrazí (mělce) a vyšle appended. */
  append(e: Omit<LogEntry, 'seq'>): LogEntry;
}

/** Prázdný log, nebo log obnovený z uložených záznamů. Záznamy musí mít seq 1..n bez mezer, jinak vyhodí. */
export function createOperationLog(entries?: readonly LogEntry[]): OperationLog;
```

V paměti je celý log (pro naše velikosti dokumentů to stačí). Na disk ho zapisuje `persistence` ([[05-persistence|05]]), která poslouchá `appended`.

**Panel historie** (M15, [[10-interakce#Historie úprav: `HistoryModel`]]) čte log jen přes `OperationLogReader`: řádek = záznam (`label` je klíč překladu nebo typ operace, ADR 0014), stav vrácení se odvodí z `rebuildUndoStacks`. Log se kvůli panelu nemění; s historií se přenáší i v souboru `.tinycad.json` ([[05-persistence#Export a import souboru]]).

## Undo / redo

Undo nemaže historii – připíše **inverzní operaci** jako nový záznam. Historie úprav tak zůstává kompletní (podobně jako mikroverze v Onshape).

```ts
export interface UndoManager extends Disposable {
  /** Zásobník není prázdný a neběží transakce. */
  canUndo(): boolean;
  canRedo(): boolean;
  /** Aktuální zásobníky (seq původních 'do', vrchol na konci). Pro testy a historii v UI. */
  stacks(): { readonly undo: readonly number[]; readonly redo: readonly number[] };
  /** Vezme seq z vrcholu undo zásobníku, dispatch(target.inverse, { kind: 'undo', target, label: target.label }). */
  undo(): void;
  /** Vezme seq z vrcholu redo zásobníku, dispatch(target.op, { kind: 'redo', target, label: target.label }). */
  redo(): void;
  /** Vyšle se jen při změně dvojice (canUndo, canRedo). */
  readonly events: Subscribable<{ changed: { canUndo: boolean; canRedo: boolean } }>;
}

/** Zásobníky se při vytvoření spočítají z logu, pak se průběžně aktualizují z log.appended. */
export function createUndoManager(deps: { dispatcher: OperationDispatcher; log: OperationLogReader }): UndoManager;

/** Zásobníky z metadat záznamů (seq původních 'do', vrchol na konci pole). Čistá funkce. */
export function rebuildUndoStacks(entries: readonly LogEntry[]): { undo: number[]; redo: number[] };
```

Pravidla (jeden krok `step(stacks, entry)`, sdílený `rebuildUndoStacks` i živým `UndoManager`):
- `do` → push `seq` na undo, vyprázdní redo,
- `undo` → vrchol undo musí být `target`; přesune ho na redo,
- `redo` → vrchol redo musí být `target`; přesune ho na undo,
- nesedí-li `target` s vrcholem, log je poškozený → `rebuildUndoStacks` vyhodí s `seq` záznamu.

Živý `UndoManager` poslouchá `log.appended` a volá tentýž `step`. Zásobníky tak z konstrukce odpovídají `rebuildUndoStacks(log.entries())` → undo funguje i po zavření a znovuotevření dokumentu.

- `undo` při `!canUndo()` (prázdný zásobník nebo běžící transakce) vyhodí. Stejně `redo`.
- Selže-li dispatch inverze, log se nezmění, a proto se nezmění ani zásobníky.
- `changed` se vyšle i při začátku a konci transakce, pokud se tím změní `canUndo`/`canRedo` (poslouchá `dispatcher.events.transaction`).
- `dispose` odhlásí odběry.

Redo aplikuje původní `op` znovu a inverzi spočítá znovu z aktuálního stavu. Díky tomu je redo správné, i kdyby se stav mezi tím nějak lišil.

## Přehrání a upcast

```ts
/** Aplikuje entry.op všech záznamů v pořadí přes applyOperation. Výjimky letí. */
export function replayLog(doc: DocumentWriter, handlers: OpHandlerRegistry, entries: readonly LogEntry[]): void;

export interface OperationLoadError { readonly path: string; readonly message: string }

/** Data zvenku → operace aktuální verze. */
export function upcastOperation(handlers: OpHandlerRegistry, raw: unknown): Result<Operation, OperationLoadError>;
```

`replayLog` přehrává `op` u všech druhů záznamů – u `undo` je v `op` inverze, tedy přesně to, co se aplikovalo.

`upcastOperation` kontroluje jen **obálku** operace:
- `raw` je objekt, `type` je řetězec, `v` je celé číslo ≥ 1, jinak `err` s cestou (`''`, `'type'`, `'v'`),
- `type: 'batch'` → dávka má vlastní verzi 1 (`v` jiné než 1 → `err` jako novější verze), `ops` je pole a každá podoperace projde rekurzivně. Cesta se skládá `ops[i]` + `.` + cesta v podoperaci (`'ops[2].v'`, `'ops[0].ops[1]'`). Výsledkem je nová dávka z převedených podoperací,
- neznámý `type` → `err`,
- `v` větší než `handler.version` → `err` (log z novější verze aplikace),
- `v` menší: handler bez `upcast` → `err`, jinak `handler.upcast(v, raw)`. Výsledek musí mít `v === handler.version` (jinak výjimka – chyba v migraci, ne v datech),
- `v` rovné → `ok(raw)`.

Po obálce (a případném `upcast`) zavolá `handler.validate`, pokud ho handler má ([[Q032 Kontrola payloadu operací při načítání|Q032]]). První nalezený problém → `err` s cestou relativní k operaci (`'featureId'`, `'feature.typeVersion'`; v dávce s prefixem `ops[i].`). `validate` kontroluje jen **tvar**, ne vztah ke stavu dokumentu (existence featury, rozsah indexu). To ohlásí až `apply` výjimkou při přehrání.

Všech deset vestavěných handlerů `validate` má:

| `type` | Kontrola |
|---|---|
| `feature.add` | `feature` je objekt: `id` a `type` neprázdný řetězec, `typeVersion` celé číslo ≥ 1, `name` řetězec, `suppressed` boolean, `params` objekt (ne pole, ne `null`). `index` celé číslo ≥ 0. |
| `feature.remove` | `featureId` neprázdný řetězec |
| `feature.setParams` | `featureId` neprázdný řetězec, `typeVersion` celé číslo ≥ 1, `params` objekt (ne pole, ne `null`) |
| `feature.rename` | `featureId` neprázdný řetězec, `name` řetězec |
| `feature.suppress` | `featureId` neprázdný řetězec, `suppressed` boolean |
| `feature.move` | `featureId` neprázdný řetězec, `toIndex` celé číslo ≥ 0 |
| `studio.setRollback` | `index` celé číslo ≥ 0 |
| `body.rename` | `body` ve tvaru id tělesa (`parseBodyId`), `name` řetězec |
| `body.setVisible` | `body` ve tvaru id tělesa, `visible` boolean |
| `body.setColor` (M15) | `body` ve tvaru id tělesa, `color` `null` nebo `isBodyColor` (`/^#[0-9a-f]{6}$/`; velká písmena neprojdou, handler nekanonizuje – přehrání je pak deterministické bez převodu) |

Hodnoty `params` proti schématu featury se při načítání nekontrolují a nemigrují; migrace běží až při `apply` ([[#Migrace dat featur]]).

### Načtení záznamu logu

```ts
/** Data zvenku → LogEntry. Pro persistence (spec 05). */
export function parseLogEntry(handlers: OpHandlerRegistry, raw: unknown): Result<LogEntry, OperationLoadError>;
```

- `raw` je objekt, `seq` celé číslo ≥ 1, `kind` je `'do' | 'undo' | 'redo'`, `label` řetězec, `time` konečné číslo.
- `target`: u `undo`/`redo` celé číslo ≥ 1 a menší než `seq`, u `do` chybí (`target: undefined` se bere jako chybějící, ve shodě s `exactOptionalPropertyTypes`). Že `target` ukazuje na `do` záznam, nekontroluje: to pozná `rebuildUndoStacks` (vyhodí).
- `op` a `inverse` projdou `upcastOperation`. Cesta chyby dostane prefix `op.` / `inverse.` (`'op.featureId'`, `'inverse'` pro chybu celé operace).
- Výsledek je nový objekt jen se známými poli (přebytečná pole z úložiště se zahodí).

## Testy

- Každý vestavěný handler: `invert` → `apply(op)` → `apply(inverze)` vrátí dokument do původního stavu (porovnání `toData`); `invert` dokument nezmění; `invert` na neexistující featuru vyhodí.
- `applyOperation`: obalení inverze obnovou baru u add/remove/move před barem, na baru a za barem; bez obalení u `studio.setRollback`; dávka včetně vnořené a prázdné; atomičnost dávky při selhání podoperace; výjimka odběratele (beze změny vs. se změnou).
- Dispečer: pořadí invert → apply → append → emit; selhání handleru nezapíše záznam; výjimka odběratele po změně zapíše záznam a pak letí; `dispatch` během transakce vyhodí; nekonzistentní `meta` vyhodí; výchozí `label` je `op.type`; `time` z `now`.
- Log: `seq` od 1, `entries(fromSeq)`, `appended`, obnova ze záznamů, mezera v `seq` vyhodí.
- Přechodná operace: commit ji vrátí a záznam ji neobsahuje; abort vrátí vše v opačném pořadí; transakce jen s přechodnými kroky nezapíše nic; replay logu dá stejný dokument jako po commitu.
- Transakce: commit = jeden záznam; **50 změn parametru = 1 záznam**; add + setParams = `batch` se 2 operacemi; abort = dokument i log beze změny; prázdná transakce nezapíše nic; druhý `begin` vyhodí; volání po ukončení vyhodí; `transaction` události.
- `merge` u `setParams`: stejná featura → `next`, jiná → `null`.
- Migrace při `apply` (Q035): `feature.add` s featurou starší verze vloží featuru aktuální verze; `setParams` s nižším `typeVersion` nastaví migrované parametry a `typeVersion` schématu; neznámý typ beze změny; selhání migrace → výjimka a dokument beze změny; `upcast` `setParams` 1 → 2 doplní `typeVersion: 1`; `validate` `setParams` odmítne chybějící nebo necelý `typeVersion`.
- Undo/redo sekvence včetně „undo, nová změna, redo není možné“; undo během transakce vyhodí; `changed` jen při změně dvojice; undo s posunem rollback baru.
- `rebuildUndoStacks` = živé zásobníky; poškozený log vyhodí; **undo po „znovuotevření“** (nový log z `entries()`, nový dokument přes `replayLog`, nový `UndoManager`) se chová stejně jako v živé session.
- `upcastOperation`: aktuální verze, fiktivní v1 → v2, chybějící `upcast`, novější verze, neznámý typ, rozbitá obálka i uvnitř dávky.
- `validate` každého vestavěného handleru: platná operace projde, každé pole z tabulky rozbité zvlášť → `err` se správnou cestou; v dávce s prefixem.
- `parseLogEntry`: platný záznam každého `kind`, každé pole rozbité zvlášť, `target` u `do`, chyba v `op` i `inverse` s prefixem cesty, upcast staré verze operace uvnitř záznamu.
- `body.rename`, `body.setVisible` a `body.setColor` (M15): inverze vrátí metadata, `invert` tělesa bez metadat, `validate` s rozbitým `body`.
- **Replay test** (fast-check, 1000 sekvencí): náhodné operace (od M11 včetně `body.*`, od M15 i `body.setColor`), transakce (commit i abort), undo a redo; pak `replayLog` na prázdný dokument → `toData` se shoduje se živým dokumentem a `rebuildUndoStacks` se shoduje se živými zásobníky.

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
