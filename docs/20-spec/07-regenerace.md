---
type: spec
status: implemented
order: 7
aliases:
  - regen – regenerace historie
  - Spec 07
modules:
  - regen
milestones:
  - "[[M06-regenerace]]"
tags:
  - spec
created: 2026-10-12
updated: 2026-10-13
---
# 07 – `regen`: regenerace historie

> **Pojmy:** [[Regenerace]], [[Stav regenerace]], [[Builder featury]], [[Těleso]], [[Rollback bar]], [[Mark and sweep]], [[Neměnná data]]  
> **Rozhodnutí:** [[0006-nemenna-data]], [[0004-data-oddelene-od-chovani]]  
> **Milník:** [[M06-regenerace]]

Přehraje featury Part Studia přes geometrické jádro a vytvoří výsledná tělesa. Tady žije **chování** featur (buildery). Závisí na `core`, `document`, `kernel`; operace (`ops`) nezná.

## Princip

Každá featura je funkce `výstupní stav = f(vstupní stav, parametry)`. Stav je neměnný snímek toho, co existuje po dané featuře:

```ts
export interface Body {
  readonly id: BodyId;                // stabilní jméno, např. 'f3k9/body'
  readonly shape: ShapeHandle;
  readonly createdBy: FeatureId;
  readonly names: NameTable;          // topologická jména ploch/hran tohoto tvaru (spec 08), do M14 prázdné
}

export interface RegenState {
  readonly bodies: ReadonlyMap<BodyId, Body>;
}

export const EMPTY_STATE: RegenState;
```

`RegenState` se mrazí `Object.freeze` jen na úrovni objektu. Mapu těles za běhu nic nehlídá, chrání ji typ `ReadonlyMap` ([[Q048 Neměnnost mapy těles za běhu|Q048]]): stav zapisují jen buildery v repu, ne cizí data.

Builder mrazí objekt nového stavu i každé nové `Body` (`Object.freeze`), mapu ne. Regenerator stejně mrazí každý `FeatureStatus` (i `FeatureError`) a `RegenResult`; mapu `statuses` chrání typ `ReadonlyMap`. Statusy jdou posluchačům a do UI a zároveň zůstávají v cache.

## Builder featury

```ts
export interface FeatureBuilder<P = unknown> {
  readonly type: string;
  build(input: BuildInput<P>, ctx: BuildContext): Promise<BuildOutput>;
}

export interface BuildInput<P> {
  readonly feature: FeatureInstance<P>;
  readonly state: RegenState;          // stav před touto featurou
}

/** Část jádra, kterou smí builder používat: tvoří a ptá se, neuvolňuje (Q041). */
export type ModelingKernel = PrimitiveOps & QueryOps;   // M13 přidá BooleanOps

export interface BuildContext {
  /** Sledované jádro: každý vrácený handle patří Regeneratoru (Q041). */
  readonly kernel: ModelingKernel;
  /** Tělesa ze vstupního stavu; první nevyřešená reference → err (Q044). */
  resolveBodies(refs: readonly BodyRef[]): Result<Body[], RefError>;
  /** Více volání se spojí znakem '\n' do statusu 'warning' (Q045). */
  warn(message: string): void;
  // resolveTopo(refs: readonly TopoRef[]): Result<ResolvedTopo[], RefError> – přidá M14
}

export interface RefError {
  readonly ref: BodyRef;        // v M14 i TopoRef
  readonly message: string;
}

export type BuildOutput =
  | { ok: true; state: RegenState }
  | { ok: false; error: FeatureError };

export type BuilderRegistry = Registry<FeatureBuilder>;   // klíč = type, viz core; chybějící builder → find() = undefined
export function createBuilderRegistry(): BuilderRegistry;
```

Pravidla pro builder:
- nesmí mutovat vstupní stav, vrací nový (`new Map(state.bodies)` + změny),
- nesmí uvolňovat handle (to dělá `Regenerator`),
- všechny tvary vytváří přes `ctx.kernel`, ten každý vrácený handle zapíše do množiny vlastněné Regeneratorem – i mezivýsledky a tvary z builderu, který pak selže ([[Q041 Úklid mezivýsledků builderu|Q041]]),
- očekávanou chybu vrací jako `{ ok: false }` (nevyřešenou referenci jako `UNRESOLVED_REFERENCE`, [[Q044 RefError a nevyřešené reference|Q044]]), výjimky jádra může nechat proletět – `Regenerator` je převede na chybu featury `KERNEL`. Výjimka, která z jádra nepochází (`kernelErrorCode(e) === undefined`), je chyba programu: `run` po úklidu handle odmítne s touto výjimkou ([[Q043 Výjimka builderu mimo jádro|Q043]]),
- validaci parametrů neřeší – `Regenerator` před voláním builderu zavolá `schema.validate` a při problému builder vůbec nespustí (status `INVALID_PARAMS`). Builder tedy smí předpokládat platné parametry.

Příklad:

```ts
export const boxBuilder: FeatureBuilder<BoxParams> = {
  type: 'box',
  async build({ feature, state }, { kernel }) {
    const { origin, width, depth, height } = feature.params;
    const r = await kernel.makeBox({ origin, size: [width, depth, height] });
    const id = `${feature.id}/body` as BodyId;
    const bodies = new Map(state.bodies).set(id, { id, shape: r.shape, createdBy: feature.id, names: EMPTY_NAMES });
    return { ok: true, state: { bodies } };
  },
};
```

## Stav featury

```ts
export type FeatureStatus =
  | { kind: 'ok' }
  | { kind: 'warning'; message: string }
  | { kind: 'error'; error: FeatureError }
  | { kind: 'suppressed' }
  | { kind: 'rolledBack' }          // za rollback barem
  | { kind: 'pending' };            // ještě nepřepočítaná

export interface FeatureError {
  readonly code: 'INVALID_PARAMS' | 'UNRESOLVED_REFERENCE' | 'KERNEL' | 'UNKNOWN_TYPE';
  readonly message: string;                      // technický text (log, chyby jádra)
  readonly issues?: readonly ParamIssue[];       // jen INVALID_PARAMS: problémy z schema.validate (M10, ADR 0014)
}
```

Status featury určí `Regenerator` v tomto pořadí:

1. pozice `>= rollbackIndex` → `rolledBack` (builder se nevolá, v cache zůstává, co tam bylo),
2. `suppressed` → `suppressed`, stav se propustí,
3. chybí schéma nebo builder pro `type` → `error` `UNKNOWN_TYPE`,
4. `schema.validate(params)` vrátí problémy → `error` `INVALID_PARAMS` s `issues` (zmrazená kopie) a technickou `message` `'param: code; …'`, builder se nevolá. UI chybu překládá z `issues`, ne z `message` (rozhodnutí 2026-10-13),
5. builder vrátí `{ ok: false }` → `error` s jeho chybou; výjimka s kódem jádra → `error` `KERNEL`,
6. builder vrátil stav a volal `warn` → `warning`, jinak `ok`.

`pending` Regenerator nevrací, používá ho UI před první regenerací.

Regenerator předpokládá, že parametry jsou ve verzi aktuálního schématu – migraci (`typeVersion` → `schema.version`) dělá `fromData` při načtení ([[03-dokument]]).

Když builder (nebo jiné volání jádra) odmítne s `RpcError` `'disconnected'`, jádro zaniklo i se všemi handle ([[Q049 Pád jádra během regenerace|Q049]]): featura nedostane status, `run` odmítne s touto chybou a regen hned – bez volání `release` – vyprázdní cache i vlastněnou množinu a přejde do stavu **mrtvý**: běžící i každý další `run` odmítne původní chybou `'disconnected'` (i běh, který jádro vůbec nevolá a vše bere z cache). Ochranou je tento příznak, ne pořadí zápisů: mrtvý Regenerator cache už nikdy nečte. Mrtvý `run` odmítne hned, bez zvýšení generace a bez `started`. Zotavení řeší `app`: nové jádro a nový Regenerator.

Když `run` odmítne kvůli výjimce mimo jádro ([[Q043 Výjimka builderu mimo jádro|Q043]]), cache se nezapíše a zůstane z předchozího běhu. Handle vytvořené v přerušeném běhu proto nejsou živé a sweep je uvolní.

**Chybná featura propouští stav beze změny** (chová se jako no-op), následující featury se přepočítají normálně. Je to chování Onshape: jedna červená featura nerozbije zbytek modelu, pokud na ní nic nezávisí.

## Regenerator

```ts
export interface Regenerator {

  /** Přepočítá studio. Volání během běžící regenerace ji nahradí (starý výsledek se zahodí). */
  run(studio: PartStudioData): Promise<RegenResult | 'superseded'>;

  readonly events: Subscribable<RegenEvents>;
}

export interface RegenEvents {      // exportovaný typ, app ho pojmenuje
  readonly started: { readonly generation: number };
  readonly featureDone: { readonly generation: number; readonly featureId: FeatureId; readonly status: FeatureStatus };
  readonly finished: { readonly generation: number; readonly result: RegenResult };
}

export function createRegenerator(deps: {
  kernel: GeometryKernel; builders: BuilderRegistry; schemas: FeatureSchemaRegistry;
  now: () => number;                // hodiny pro durationMs, dodá app (Q046)
}): Regenerator;

export interface RegenResult {
  readonly generation: number;
  readonly finalState: RegenState;                 // stav na rollback baru
  readonly statuses: ReadonlyMap<FeatureId, FeatureStatus>;
  readonly durationMs: number;
}
```

### Cache podle identity

Regenerator si pamatuje pro každou pozici `i` trojici *(instance featury, výstupní stav, status)* ([[Q042 Obsah cache regenerace|Q042]]). Cache obsahuje i chybné a suppressed featury, ne však `rolledBack`. Při `run`:

1. Projde featury od začátku a najde první index `k`, kde `features[i] !== cache[i].feature` (porovnání **identity objektu**). Díky neměnným datům změna parametru, vložení, smazání i přesun featury automaticky změní identitu na dané pozici nebo posune pole. ([[0006-nemenna-data|ADR 0006]])
2. Cache `0..k-1` platí. Stav před `k` je `cache[k-1].state` (nebo `EMPTY_STATE`).
3. Přepočítá featury `k .. rollbackIndex-1`. Suppressed featury jen propustí stav.
4. Featury za rollback barem dostanou status `rolledBack`, nepočítají se.
5. Nová cache = `cache[0..k-1]` + záznamy nově spočítaných featur `k..rollbackIndex-1`. Když `k >= rollbackIndex`, nepočítá se nic a cache se jen zkrátí na `0..k-1`, takže záznamy za barem, které stále platí, zůstanou.

Posun rollback baru dopředu tak přepočítá jen nově zahrnuté featury, posun dozadu nepočítá nic.

### Souběh (generace)

- Každé `run` zvýší `generation`. Po každém `await` builder smyčka ověří, že je stále aktuální generací; pokud ne, skončí a vrátí `'superseded'`.
- Cache zapisuje jen aktuální generace.
- `started` a `featureDone` se vysílají i pro generaci, která pak skončí jako `'superseded'` (posluchač filtruje podle `generation`). `finished` jen pro dokončenou generaci, jako poslední událost před vyřešením promise.
- `featureDone` dostane každá featura studia právě jednou, v pořadí featur: featury z cache hned po `started`, přepočítaná featura hned po svém buildu, `rolledBack` featury při sestavení výsledku. Featura, jejíž build doběhl až po nahrazení generace, událost nedostane.
- Výjimka mimo jádro (Q043) odmítne `run` i v generaci, která už je nahrazená – chyba programu se neschová do `'superseded'`. Sweep po ní ale udělá jen aktuální generace.
- Výjimka posluchače události je také chyba programu: `Emitter` ji pošle dál a `run` odmítne. U `started`/`featureDone` se cache nezapíše (jako u Q043); u `finished` už je cache zapsaná a uklizená a zůstává, výsledek je platný.
- Plánování (debounce, „spusť znovu po doběhnutí“) dělá `RegenScheduler` v `app`, ne `Regenerator`.

### Životnost handle: mark & sweep

Stavy sdílejí handle (těleso, které featura nezměnila, prochází dál se stejným handle). Počítání referencí by bylo křehké, proto:

1. Po každé dokončené regeneraci se projdou všechny stavy v cache a posbírá se množina **živých** handle.
2. Všechny handle, které Regenerator kdy dostal od jádra a nejsou živé, se uvolní (`kernel.release`).
3. Handle vytvořené v rámci zahozené (superseded) generace se uvolní nejpozději při sweepu prvního dokončeného běhu, který začne po jejich vytvoření (build nahrazeného běhu může doběhnout až po sweepu generace, která ho nahradila).

Regenerator proto vede množinu „vlastněných“ handle. Plní ji sledované jádro v `BuildContext` ([[Q041 Úklid mezivýsledků builderu|Q041]]). Test ověří, že po sekvenci změn platí `kernel.liveHandleCount() === počet živých`.

Sweep běží na konci každého `run`, který skončí jako aktuální generace – výsledkem i výjimkou (Q043, chyba posluchače). Běh, který skončí jako nahrazený, neuklízí. Superseded běh sám neuklízí – jeho handle uklidí sweep generace, která ho nahradila. Všechny nepotřebné handle se uvolní **jedním** voláním `kernel.release`. Když `release` odmítne ([[Q040 Selhání release při úklidu handle|Q040]]):

- `'unknown-handle'` – chyba programu (regen vlastnil handle, který jádro nezná): `run` odmítne s touto chybou. `release` je atomický, handle proto zůstanou ve vlastněné množině a každý další sweep selže znovu – chyba programu má být hlasitá, ne tichý únik,
- jiný kód jádra (`'internal'`) – handle zůstanou ve vlastněné množině a zkusí se při příštím sweepu, `run` se vyřeší normálně,
- `RpcError` `'disconnected'` ([[Q037 Pád workeru a čekající RPC volání|Q037]]) – jádro je pryč, vlastněná množina i cache se vyprázdní, `run` odmítne s touto chybou,
- jiná chyba bez kódu jádra – chyba programu jako u Q043: handle zůstanou ve vlastněné množině, `run` odmítne.

Handle se z vlastněné množiny odeberou ještě před čekáním na `release` (souběžný sweep novějšího běhu je tak neuvolní podruhé) a při selhání s kódem jádra se vrátí. Sweep proběhne před `finished`, `durationMs` ho zahrnuje. Když během čekání na `release` začne novější běh, vrátí `run` `'superseded'`. Když `run` odmítne kvůli `release`, `finished` se nevyšle. Po výjimce builderu nebo posluchače má původní výjimka přednost před chybou sweepu.

`render` drží handle jen pro dobu tessellace a nikdy ho neuvolňuje. Pokud by tessellace doběhla po uvolnění, jádro odmítne s kódem `'unknown-handle'` (`kernelErrorCode`) a `render` výsledek zahodí (je stejně zastaralý).

## Testy (s `FakeKernel`)

- Změna parametru featury 3 z 5 přepočítá jen 3–5 (počítadlo volání builderu).
- Posun rollback baru dozadu nevolá jádro, posun zpět dopředu také ne.
- Chybná featura: status `error`, následující featury `ok`, stav propuštěn.
- Neplatné parametry → `INVALID_PARAMS`, builder se nezavolá.
- Neznámý typ featury (chybí schéma nebo builder) → `UNKNOWN_TYPE`, regenerace pokračuje.
- Suppressed featura propustí stav, builder se nezavolá.
- Status z cache se zachová (`warning` i `error` featury před změnou).
- `warn` dvakrát → jeden `warning` se zprávami spojenými `'\n'`.
- Výjimka jádra (`failNext('makeBox', …)`) → `KERNEL`; jiná výjimka → `run` odmítne a handle se přesto uklidí.
- Builder vytvoří mezivýsledek a vrátí chybu → handle se uvolní.
- Souběh: dvě rychlé `run`, první vrátí `'superseded'`, cache odpovídá druhé, žádné úniky.
- Události: pořadí `started`, `featureDone`…, `finished`; `finished` jen pro dokončenou generaci.
- `release` selže: `unknown-handle` → odmítnutí; `internal` → úklid při dalším běhu; `disconnected` → cache prázdná.
- `durationMs` z falešných hodin.
- Property-based (fast-check): regenerace s cache = regenerace od nuly (stejná tělesa a statusy); po náhodné sekvenci změn žádné úniky handle.

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
