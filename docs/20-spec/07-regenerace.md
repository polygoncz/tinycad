---
type: spec
status: draft
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
updated: 2026-10-12
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

export interface BuildContext {
  readonly kernel: GeometryKernel;
  resolveBodies(refs: readonly BodyRef[]): Result<Body[], RefError>;
  resolveTopo(refs: readonly TopoRef[]): Result<ResolvedTopo[], RefError>;   // M14
  warn(message: string): void;
}

export type BuildOutput =
  | { ok: true; state: RegenState }
  | { ok: false; error: FeatureError };

export class BuilderRegistry { register(b: FeatureBuilder): void; get(type: string): FeatureBuilder | undefined }
```

Pravidla pro builder:
- nesmí mutovat vstupní stav, vrací nový (`new Map(state.bodies)` + změny),
- nesmí uvolňovat handle (to dělá `Regenerator`),
- očekávanou chybu vrací jako `{ ok: false }`, výjimky jádra může nechat proletět – `Regenerator` je převede na chybu featury,
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

export interface FeatureError { readonly code: 'INVALID_PARAMS' | 'UNRESOLVED_REFERENCE' | 'KERNEL' | 'UNKNOWN_TYPE'; readonly message: string }
```

**Chybná featura propouští stav beze změny** (chová se jako no-op), následující featury se přepočítají normálně. Je to chování Onshape: jedna červená featura nerozbije zbytek modelu, pokud na ní nic nezávisí.

## Regenerator

```ts
export class Regenerator {
  constructor(kernel: GeometryKernel, builders: BuilderRegistry, schemas: FeatureSchemaRegistry);

  /** Přepočítá studio. Volání během běžící regenerace ji nahradí (starý výsledek se zahodí). */
  run(studio: PartStudioData): Promise<RegenResult | 'superseded'>;

  readonly events: Emitter<{
    started: { generation: number };
    featureDone: { generation: number; featureId: FeatureId; status: FeatureStatus };
    finished: { generation: number; result: RegenResult };
  }>;
}

export interface RegenResult {
  readonly generation: number;
  readonly finalState: RegenState;                 // stav na rollback baru
  readonly statuses: ReadonlyMap<FeatureId, FeatureStatus>;
  readonly durationMs: number;
}
```

### Cache podle identity

Regenerator si pamatuje pro každou pozici `i` dvojici *(instance featury, výstupní stav)*. Při `run`:

1. Projde featury od začátku a najde první index `k`, kde `features[i] !== cache[i].feature` (porovnání **identity objektu**). Díky neměnným datům změna parametru, vložení, smazání i přesun featury automaticky změní identitu na dané pozici nebo posune pole. ([[0006-nemenna-data|ADR 0006]])
2. Cache `0..k-1` platí. Stav před `k` je `cache[k-1].state` (nebo `EMPTY_STATE`).
3. Přepočítá featury `k .. rollbackIndex-1`. Suppressed featury jen propustí stav.
4. Featury za rollback barem dostanou status `rolledBack`, nepočítají se.

Posun rollback baru dopředu tak přepočítá jen nově zahrnuté featury, posun dozadu nepočítá nic.

### Souběh (generace)

- Každé `run` zvýší `generation`. Po každém `await` builder smyčka ověří, že je stále aktuální generací; pokud ne, skončí a vrátí `'superseded'`.
- Cache zapisuje jen aktuální generace.
- Plánování (debounce, „spusť znovu po doběhnutí“) dělá `RegenScheduler` v `app`, ne `Regenerator`.

### Životnost handle: mark & sweep

Stavy sdílejí handle (těleso, které featura nezměnila, prochází dál se stejným handle). Počítání referencí by bylo křehké, proto:

1. Po každé dokončené regeneraci se projdou všechny stavy v cache a posbírá se množina **živých** handle.
2. Všechny handle, které Regenerator kdy dostal od jádra a nejsou živé, se uvolní (`kernel.release`).
3. Handle vytvořené v rámci zahozené (superseded) generace se uvolní ve stejném sweepu.

Regenerator proto vede množinu „vlastněných“ handle. Test ověří, že po sekvenci změn platí `kernel.liveHandleCount() === počet živých`.

`render` drží handle jen pro dobu tessellace a nikdy ho neuvolňuje. Pokud by tessellace doběhla po uvolnění, jádro vrátí `UNKNOWN_HANDLE` a `render` výsledek zahodí (je stejně zastaralý).

## Testy (s `FakeKernel`)

- Změna parametru featury 3 z 5 přepočítá jen 3–5 (počítadlo volání builderu).
- Posun rollback baru dozadu nevolá jádro.
- Chybná featura: status `error`, následující featury `ok`, stav propuštěn.
- Neznámý typ featury → `UNKNOWN_TYPE`, regenerace pokračuje.
- Souběh: dvě rychlé `run`, první vrátí `'superseded'`, cache odpovídá druhé.
- Žádné úniky handle po náhodné sekvenci změn.

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
