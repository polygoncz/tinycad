---
type: spec
status: draft
order: 3
aliases:
  - document – doménový model
  - Spec 03
modules:
  - document
milestones:
  - "[[M02-dokument]]"
tags:
  - spec
created: 2026-10-12
updated: 2026-10-13
---
# 03 – `document`: doménový model

> **Pojmy:** [[Dokument]], [[Part Studio]], [[Featura]], [[Schéma featury]], [[Parametr featury]], [[Rollback bar]], [[Neměnná data]]  
> **Rozhodnutí:** [[0003-dokument-je-recept]], [[0004-data-oddelene-od-chovani]], [[0006-nemenna-data]]  
> **Milník:** [[M02-dokument]]

Popisuje, **co** uživatel vytvořil: recept ze seřazených featur. Neobsahuje žádnou geometrii ani logiku jejího výpočtu. Závisí jen na `core`.

## Model

```ts
export type DocumentId = Brand<string, 'DocumentId'>;
export type FeatureId  = Brand<string, 'FeatureId'>;

export interface FeatureInstance<P = unknown> {
  readonly id: FeatureId;
  readonly type: string;          // 'box', 'cylinder', …  – klíč do registrů
  readonly typeVersion: number;   // verze schématu, se kterou byla data vytvořena
  readonly name: string;          // zobrazované jméno, 'Box 1'
  readonly params: Readonly<P>;
  readonly suppressed: boolean;   // potlačená featura se při regeneraci přeskočí
}

export interface PartStudioData {
  readonly features: readonly FeatureInstance[];
  readonly rollbackIndex: number; // 0..features.length; features[i] se přehraje, když i < rollbackIndex
}

export interface DocumentMeta {
  readonly id: DocumentId;
  readonly name: string;
  readonly createdAt: number;
}
```

Všechno je **neměnné**. Změna parametru = nová instance `FeatureInstance` a nové pole `features`. Nezměněné featury zůstávají tytéž objekty – na tom stojí cache regenerace ([[07-regenerace|07]], [[0006-nemenna-data|ADR 0006]]).

## Čtení a zápis: dvě rozhraní

```ts
export interface DocumentReader {
  readonly meta: DocumentMeta;
  readonly studio: PartStudioData;
  feature(id: FeatureId): FeatureInstance | undefined;
  indexOf(id: FeatureId): number;              // -1, když neexistuje
  readonly events: Emitter<DocumentEvents>;
}

export interface DocumentWriter extends DocumentReader {
  insertFeature(index: number, f: FeatureInstance): void;
  removeFeature(id: FeatureId): void;
  replaceFeature(f: FeatureInstance): void;     // stejné id, nová data
  moveFeature(id: FeatureId, toIndex: number): void;
  setRollbackIndex(index: number): void;
  rename(name: string): void;
}

export type DocumentEvents = {
  changed: { studio: PartStudioData };         // po každé dokončené mutaci
};

export function createDocument(init?: { meta?: DocumentMeta; studio?: PartStudioData }): DocumentWriter;
```

- `DocumentWriter` dostávají **jen handlery operací** v `ops`. Všichni ostatní pracují s `DocumentReader`. `createDocument` vrací `DocumentWriter` a `app` ho ostatním předává typovaný jako `DocumentReader`. Implementující třída (`CadDocument`) zůstává uvnitř modulu ([[0011-programovani-proti-rozhranim|ADR 0011]]). Přetypování zpět TypeScript nezakáže, hlídá to review.
- Mutátory hlídají invarianty a při porušení vyhodí výjimku (chyba programátora): unikátní `id`, `rollbackIndex` v rozsahu, vložení featury posune rollback bar, pokud se vkládá před něj.
- Mutátory **nevalidují parametry** featur. Neplatné parametry jsou legitimní stav dokumentu – featura pak při regeneraci skončí chybou (zčervená jako v Onshape).

## Reference na jiné entity

Parametry featur mohou odkazovat na výsledky jiných featur. Reference jsou vždy **jména**, nikdy indexy nebo handle.

```ts
export type BodyId = Brand<string, 'BodyId'>;   // '<featureId>/body' nebo '<featureId>/body:<n>'

export interface BodyRef { readonly kind: 'body'; readonly body: BodyId }
export type TopoName = Brand<string, 'TopoName'>;                             // viz spec 08
export interface TopoRef { readonly kind: 'topo'; readonly body: BodyId; readonly name: TopoName }
export interface SketchRegionRef { readonly kind: 'region'; readonly sketch: FeatureId; readonly region: string } // spec 12
```

## Schéma featury

Datová část typu featury: co za parametry má, jak vypadají výchozí hodnoty a jak se migrují stará data. Chování (výpočet geometrie) je v `regen` ([[0004-data-oddelene-od-chovani|ADR 0004]]).

```ts
export type ParamSpec =
  | { kind: 'length';  label: string; default: number; min?: number; max?: number }
  | { kind: 'angle';   label: string; default: number; min?: number; max?: number }
  | { kind: 'number';  label: string; default: number; min?: number; max?: number; integer?: boolean }
  | { kind: 'boolean'; label: string; default: boolean }
  | { kind: 'enum';    label: string; default: string; options: readonly { value: string; label: string }[] }
  | { kind: 'point';   label: string; default: Vec3 }
  | { kind: 'bodies';  label: string; min?: number; max?: number }            // BodyRef[]
  | { kind: 'topo';    label: string; entity: 'face' | 'edge' | 'vertex'; min?: number; max?: number } // TopoRef[]
  | { kind: 'region';  label: string; min?: number; max?: number };          // SketchRegionRef[]

export type ParamSchema = Readonly<Record<string, ParamSpec>>;

export interface FeatureSchema<P = unknown> {
  readonly type: string;
  readonly version: number;
  readonly label: string;               // 'Box'
  readonly params: ParamSchema;
  defaults(): P;
  validate(p: P): readonly ParamIssue[];          // obecná validace podle ParamSpec + vlastní pravidla
  migrate(fromVersion: number, raw: unknown): P;  // povinné, jakmile version > 1
}

export interface ParamIssue { readonly param: string; readonly message: string }

export type FeatureSchemaRegistry = Registry<FeatureSchema>;   // klíč = type, viz core
export function createFeatureSchemaRegistry(): FeatureSchemaRegistry;
```

`ParamSpec` slouží třem účelům najednou: validaci, generování formuláře v UI ([[11-ui|11]]) a rozpoznání, které parametry jsou reference (pro picking v dialogu).

Pomocná funkce `validateAgainstSchema(schema, params)` dělá obecnou kontrolu (typ, min/max, počet referencí). Schéma featury ji v `validate` zavolá a přidá vlastní pravidla.

## Serializace

```ts
export interface DocumentData {
  readonly meta: DocumentMeta;
  readonly studio: PartStudioData;     // FeatureInstance jsou už čistá JSON data
}

export function toData(doc: DocumentReader): DocumentData;
export function fromData(data: DocumentData, schemas: FeatureSchemaRegistry): DocumentWriter;
```

- `fromData` u každé featury porovná `typeVersion` s `schema.version` a případně zavolá `migrate`.
- Neznámý typ featury při načítání: featura se zachová jako „neznámá“ (data beze změny), regenerace ji označí chybou. Dokument se tím nerozbije.
- Formát musí být čisté JSON (žádné `Map`, `Date`, `undefined` v polích). Ověří test „`JSON.parse(JSON.stringify(x))` je hluboce rovno `x`“.

## Testy

- Invarianty mutátorů (duplicitní id, posun rollback baru při vložení, mazání featury za rollback barem).
- Strukturální sdílení: po `replaceFeature` jsou ostatní instance `===` původním.
- `toData` → `fromData` → `toData` je identita.
- Migrace: featura s `typeVersion: 1` se načte schématem verze 2.
- `validateAgainstSchema` pro každý `ParamSpec.kind`.

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
