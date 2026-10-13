---
type: spec
status: implemented
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

`document` nově vytvořená data vždy mrazí (`Object.freeze`), bez přepínače pro dev a produkci ([[Q027 Kdy mrazit doménová data|Q027]]). Mrazí se jen nové objekty, sdílené zůstávají, jak jsou.

## Čtení a zápis: dvě rozhraní

```ts
export interface DocumentReader {
  readonly meta: DocumentMeta;
  readonly studio: PartStudioData;
  feature(id: FeatureId): FeatureInstance | undefined;
  indexOf(id: FeatureId): number;              // -1, když neexistuje
  readonly events: Subscribable<DocumentEvents>;
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

export interface CreateDocumentInit {
  readonly meta: DocumentMeta;       // povinné: dokument si id ani čas nevymýšlí (determinismus)
  readonly studio?: PartStudioData;  // výchozí: prázdné studio, rollbackIndex 0
}
export function createDocument(init: CreateDocumentInit): DocumentWriter;
```

- `DocumentWriter` dostávají **jen handlery operací** v `ops`. Všichni ostatní pracují s `DocumentReader`. `createDocument` vrací `DocumentWriter` a `app` ho ostatním předává typovaný jako `DocumentReader`. Implementující třída (`CadDocument`) zůstává uvnitř modulu ([[0011-programovani-proti-rozhranim|ADR 0011]]). Přetypování zpět TypeScript nezakáže, hlídá to review.
- Mutátory hlídají invarianty a při porušení vyhodí výjimku (chyba programátora): unikátní `id`, `rollbackIndex` v rozsahu `0..features.length`, index v rozsahu, existující featura.
- Posun [[Rollback bar|rollback baru]] (`r`) – stav ostatních featur (aktivní/za barem) se nikdy nemění ([[Q029 Posun rollback baru při změnách featur|Q029]]):
  - `insertFeature(i)`: `i <= r` → `r + 1`. Featura vložená na bar je aktivní.
  - `removeFeature(i)`: `i < r` → `r − 1`.
  - `moveFeature(from → to)`: jako smazání na `from` a vložení na `to` (`to` je výsledný index). Přesunutá featura převezme stav cílové pozice.
  - Pravidla nejsou sama o sobě přesně invertovatelná (index rovný `r` je dvojznačný). Přesné undo zajišťuje dispečer v `ops` ([[04-operace-a-historie|04]]).
- `changed` se vyšle jen po skutečné změně. Mutace beze změny (`setRollbackIndex` na stejný index, `moveFeature` na stejné místo, `rename` na stejné jméno, `replaceFeature` se stejným objektem) nic nevyšle. `rename` vyšle `changed` s nezměněným `studio` – nové jméno odběratel přečte z `doc.meta`.
- Mutátor, jehož kontrola selže (výjimka), dokument nezmění a nic nevyšle. Výjimka **odběratele** `changed` se ale šíří z mutátoru až **po** provedení změny: dokument je změněný, i když mutátor vyhodil výjimku. Jak s tím naloží dispečer v `ops`, řeší [[Q030 Výjimka odběratele po změně dokumentu|Q030]].
- `events` vystavuje jen `on` a `once` (vlastní objekt, ne `Emitter`), takže ani přetypování nedá přístup k `emit` ([[Q023 Události jen pro odběr|Q023]]).
- Data vstupující do dokumentu (`createDocument`, `insertFeature`, `replaceFeature`) se zmrazí do hloubky bez zkratek – i mělce zmrazený objekt zvenku se zmrazí celý. Mutátory pak zmrazí jen nové pole a nové `studio`, jejichž prvky už zmrazené jsou.
- `createDocument` kontroluje invarianty i u počátečního `studio` (výjimka). Data zvenku kontroluje `fromData` předem a vrací `Result`.
- Mutátory **nevalidují parametry** featur. Neplatné parametry jsou legitimní stav dokumentu – featura pak při regeneraci skončí chybou (zčervená jako v Onshape).

## Reference na jiné entity

Parametry featur mohou odkazovat na výsledky jiných featur. Reference jsou vždy **jména**, nikdy indexy nebo handle. Značkovaná id (`FeatureId`, `BodyId`…) vznikají přetypováním jen na dvou důvěryhodných místech: při generování id v `ops` a v `fromData` po kontrole tvaru dat.

```ts
export type BodyId = Brand<string, 'BodyId'>;   // '<featureId>/body' nebo '<featureId>/body:<n>'

export interface BodyRef { readonly kind: 'body'; readonly body: BodyId }
export type TopoName = Brand<string, 'TopoName'>;                             // viz spec 08
export interface TopoRef { readonly kind: 'topo'; readonly body: BodyId; readonly name: TopoName }
export interface SketchRegionRef { readonly kind: 'region'; readonly sketch: FeatureId; readonly region: string } // spec 12

export type EntityRef = BodyRef | TopoRef | SketchRegionRef;   // diskriminováno podle kind
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
  validate(params: unknown): readonly ParamIssue[]; // unknown: parametry z dokumentu jsou neověřené
  migrate?(fromVersion: number, raw: unknown): P;   // povinné, jakmile version > 1 – hlídá registr
}

export interface ParamIssue { readonly param: string; readonly message: string }   // param '' = parametry jako celek

export type FeatureSchemaRegistry = Registry<FeatureSchema>;   // klíč = type, viz core
export function createFeatureSchemaRegistry(): FeatureSchemaRegistry;
```

- `validate` bere `unknown`, ne `P`: validace teprve zjišťuje, jestli data odpovídají `P` (stejně jako `fromData`).
- `migrate` je v typu volitelná, protože pravidlo „povinné od verze 2“ závisí na hodnotě. Hlídá ho `register()` registru schémat: verze musí být celé číslo ≥ 1 a schéma s `version > 1` bez `migrate` se odmítne výjimkou už při startu.
- Referenční `ParamSpec` (`bodies`, `topo`, `region`) bez `min`/`max` připouští `0..∞` referencí. Povinnost aspoň jedné reference vyjádří schéma přes `min: 1`.
- Typ entity u `topo` (`face`/`edge`/`vertex`) obecná validace neověřuje – zjistí se až po regeneraci.

`ParamSpec` slouží třem účelům najednou: validaci, generování formuláře v UI ([[11-ui|11]]) a rozpoznání, které parametry jsou reference (pro picking v dialogu).

Pomocná funkce `validateAgainstSchema(schema, params)` dělá obecnou kontrolu (typ, min/max, počet referencí). Schéma featury ji v `validate` zavolá a přidá vlastní pravidla.

- Chybějící parametr (je ve schématu, ne v `params`) i přebytečný parametr (je v `params`, ne ve schématu) je `ParamIssue` ([[Q028 Chybějící a přebytečné parametry|Q028]]). `migrate` proto musí po sobě uklidit i parametry, které nová verze nemá.
- Referenční parametry (`bodies`, `topo`, `region`) jsou v `params` vždy, prázdné jako `[]`, i při `min: 0`.

## Serializace

```ts
export interface DocumentData {
  readonly meta: DocumentMeta;
  readonly studio: PartStudioData;     // FeatureInstance jsou už čistá JSON data
}

export function toData(doc: DocumentReader): DocumentData;
export function fromData(data: unknown, schemas: FeatureSchemaRegistry): Result<DocumentWriter, DocumentLoadError>;

export interface DocumentLoadIssue { readonly path: string; readonly message: string } // path: 'studio.features[3].id', '' = celá data
export interface DocumentLoadError { readonly issues: readonly DocumentLoadIssue[] }
```

- `fromData` čte data zvenku (persistence, import), proto bere `unknown` a vrací `Result` ([[Q026 Chyby při načítání dokumentu|Q026]]). Poškozená data nejsou chyba programátora: kontroluje se tvar dat (povinné vlastnosti a jejich typy) i invarianty dokumentu (unikátní `id`, `rollbackIndex` v rozsahu). Mutátory dál hází výjimky.
- `toData` nic nekopíruje: vrátí `meta` a `studio` dokumentu. Data jsou neměnná, takže snímek je zadarmo a konzistentní ([[0006-nemenna-data|ADR 0006]]).
- `fromData` staví kostru (meta, studio, featury) z ověřených polí znovu – výsledek má přesně tvar typu a značkovaná id vznikají až po kontrole. `params` featur nekopíruje: dokument je převezme do vlastnictví a zmrazí.
- Hlásí všechny problémy najednou, každý s cestou v datech.
- `fromData` u každé featury porovná `typeVersion` s `schema.version` a případně zavolá `migrate`. Výjimka z `migrate` i výsledek, který není objekt, je problém načtení (stará data, se kterými migrace nepočítá), ne chyba programátora. Featura novější než schéma by neměla nastat ([[Q025 Featura z novější verze|Q025]]); kdyby přesto, je to také problém načtení.
- Neznámý typ featury při načítání: featura se zachová jako „neznámá“ (data beze změny), regenerace ji označí chybou. Dokument se tím nerozbije.
- Formát musí být čisté JSON (žádné `Map`, `Date`, `undefined` v polích). Ověří test „`JSON.parse(JSON.stringify(x))` je hluboce rovno `x`“. `fromData` to u `params` (i u výsledku `migrate`) kontroluje: jen čisté objekty (prototyp `Object.prototype` nebo `null`), pole, řetězce, konečná čísla, `boolean` a `null`. IndexedDB ukládá structured clone, takže by se tam jinak `Date` nebo `Map` dostaly.
- `toData` vrací zmrazený obal.

## Testy

- Invarianty mutátorů (duplicitní id, neexistující featura, indexy mimo rozsah).
- Posun rollback baru pro vložení, smazání a přesun před barem, na baru a za barem.
- Strukturální sdílení: po `replaceFeature` jsou ostatní instance `===` původním.
- `toData` → `fromData` → `toData` je identita.
- Migrace: featura s `typeVersion: 1` se načte schématem verze 2.
- `validateAgainstSchema` pro každý `ParamSpec.kind`, chybějící a přebytečný parametr.
- `fromData` s poškozenými daty vrátí `err` s cestou k problému (duplicitní id, `rollbackIndex` mimo rozsah, chybějící vlastnost).

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
