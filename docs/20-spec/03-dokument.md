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
updated: 2026-10-14
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
  readonly bodies?: Readonly<Record<BodyId, BodyMeta>>;   // metadata těles (M11), viz Metadata těles; chybí, když je prázdné
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
  bodyMeta(body: BodyId): BodyMeta;            // {} (sdílený zmrazený objekt) pro těleso bez metadat (M11)
  readonly events: Subscribable<DocumentEvents>;
}

export interface DocumentWriter extends DocumentReader {
  insertFeature(index: number, f: FeatureInstance): void;
  removeFeature(id: FeatureId): void;
  replaceFeature(f: FeatureInstance): void;     // stejné id, nová data
  moveFeature(id: FeatureId, toIndex: number): void;
  setRollbackIndex(index: number): void;
  setBodyMeta(body: BodyId, meta: BodyMeta): void;   // M11, viz Metadata těles
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
- `changed` se vyšle jen po skutečné změně. Mutace beze změny (`setRollbackIndex` na stejný index, `setBodyMeta` se stejnými metadaty (po hodnotě), `moveFeature` na stejné místo, `rename` na stejné jméno, `replaceFeature` se stejným objektem) nic nevyšle. `rename` vyšle `changed` s nezměněným `studio` – nové jméno odběratel přečte z `doc.meta`.
- Mutátor, jehož kontrola selže (výjimka), dokument nezmění a nic nevyšle. Výjimka **odběratele** `changed` se ale šíří z mutátoru až **po** provedení změny: dokument je změněný, i když mutátor vyhodil výjimku. Jak s tím naloží dispečer v `ops`, řeší [[Q030 Výjimka odběratele po změně dokumentu|Q030]].
- `events` vystavuje jen `on` a `once` (vlastní objekt, ne `Emitter`), takže ani přetypování nedá přístup k `emit` ([[Q023 Události jen pro odběr|Q023]]).
- Data vstupující do dokumentu (`createDocument`, `insertFeature`, `replaceFeature`) se zmrazí do hloubky bez zkratek – i mělce zmrazený objekt zvenku se zmrazí celý. Mutátory pak zmrazí jen nové pole a nové `studio`, jejichž prvky už zmrazené jsou.
- `createDocument` kontroluje invarianty i u počátečního `studio` (výjimka). Data zvenku kontroluje `fromData` předem a vrací `Result`.
- Mutátory **nevalidují parametry** featur. Neplatné parametry jsou legitimní stav dokumentu – featura pak při regeneraci skončí chybou (zčervená jako v Onshape).

## Reference na jiné entity

Parametry featur mohou odkazovat na výsledky jiných featur. Reference jsou vždy **jména**, nikdy indexy nebo handle. Tvar id se kontroluje na datové hranici: `FeatureId` nesmí být prázdné ani obsahovat `/` (`fromData`, `validate` u `feature.add`), `BodyId` v referenci musí mít tvar `<vlastník>/body[:<n>]` (`readRef`); asserty v `bodyId` a `originOfBody` jsou pak jen pojistka proti chybě programu. Značkovaná id (`FeatureId`, `BodyId`…) vznikají přetypováním jen na důvěryhodných místech: při generování id v `interaction` (`FeatureEditor`), v `fromData` po kontrole tvaru dat, v `bodyId` (ražba `BodyId`, [[0015-artefakty-a-identita-telesa|ADR 0015]]), v `parseBodyId` (kontrola tvaru id tělesa z dat zvenku, M11: klíče metadat v `fromData`, `validate` operací `body.*`) a v interní kontrole tvaru reference `readRef`, kterou sdílí `validateAgainstSchema` a `referencesOf`.

```ts
export type BodyId = Brand<string, 'BodyId'>;   // '<featureId>/body' nebo '<featureId>/body:<n>'

export interface BodyRef { readonly kind: 'body'; readonly body: BodyId }
export type TopoName = Brand<string, 'TopoName'>;                             // viz spec 08
export interface TopoRef { readonly kind: 'topo'; readonly body: BodyId; readonly name: TopoName }
export interface SketchRegionRef { readonly kind: 'region'; readonly sketch: FeatureId; readonly region: string } // spec 12

export type EntityRef = BodyRef | TopoRef | SketchRegionRef;   // diskriminováno podle kind
```

### Id těles a závislosti

Id artefaktu má vždy tvar `<vlastník>/<druh>[:<n>]` ([[0015-artefakty-a-identita-telesa|ADR 0015]]). Razí ho jediné místo v `document`; builder nepřetypovává. Z referencí featury tak plyne, na kterých featurách závisí – čisté funkce, které v [[M11-dalsi-entity|M11]] použijí pravidla přesunu a mazání:

```ts
export function bodyId(origin: FeatureId, n?: number): BodyId;   // '<origin>/body', s n >= 1 '<origin>/body:<n>'; n < 1 nebo neceločíselné → výjimka; prázdný origin nebo origin s '/' → výjimka
export function originOfBody(body: BodyId): FeatureId;            // text před prvním '/'; bez '/' → výjimka (chyba programu)
export function ownerOf(ref: EntityRef): FeatureId;               // body, topo → originOfBody(ref.body); region → ref.sketch
export function parseBodyId(v: unknown): BodyId | undefined;      // text ve tvaru '<vlastník>/body[:<n>]' (n ≥ 1) → BodyId, jinak undefined (M11)

export function referencesOf(schema: FeatureSchema, params: unknown): readonly EntityRef[];
export function dependenciesOf(studio: PartStudioData, schemas: RegistryReader<FeatureSchema>): ReadonlyMap<FeatureId, readonly FeatureId[]>;
export function dependentsOf(deps: ReadonlyMap<FeatureId, readonly FeatureId[]>, id: FeatureId): readonly FeatureId[];
export interface OrderViolation { readonly feature: FeatureId; readonly dependsOn: FeatureId }
export function orderViolations(studio: PartStudioData, deps: ReadonlyMap<FeatureId, readonly FeatureId[]>): readonly OrderViolation[];
```

- `referencesOf` projde `schema.params` v pořadí schématu; u druhů `bodies`, `topo` a `region` vezme z hodnoty jen položky, které jsou platnou referencí daného druhu (stejná kontrola tvaru jako `validateAgainstSchema`); u `body` a `topo` je součástí tvaru i id tělesa `<vlastník>/body[:<n>]` (`n` ≥ 1), jiný řetězec je `param.invalidRef`; hodnotu, která není pole, a neplatné položky přeskočí (hlásí je validace); `params`, které nejsou objekt → `[]`. Výsledek i položky jsou zmrazené kopie.
- `dependenciesOf`: pro každou featuru studia v pořadí vlastníci jejích referencí přes `ownerOf`, bez duplicit, v pořadí prvního výskytu, jen featury, které ve studiu existují (nevyřešenou referenci hlásí regenerace), bez vlastní featury; neznámý typ → `[]`. Počítá se pro všechny featury studia včetně potlačených a za rollback barem (pravidla v M11 si stav featury ověří samy).
- `dependentsOf`: featury, jejichž závislosti obsahují `id`, v pořadí mapy.
- `orderViolations`: dvojice, kde závislost leží na indexu ≥ index featury. Prázdné = pořadí platné; pořadí výsledku podle featur, pak závislostí.

### Metadata těles

Jméno a skrytí [[Těleso|tělesa]] patří do dokumentu ([[M11-dalsi-entity|M11]], [[Q071 Viditelnost těles|Q071]]): přežijí reload, jdou přes operace a undo ([[04-operace-a-historie#Sada operací]]). Smí tam až od [[0015-artefakty-a-identita-telesa|ADR 0015]]: `BodyId` je rodokmen (featura původu), takže se metadata po změně historie nepřenesou na jiné těleso.

```ts
export interface BodyMeta { readonly name?: string; readonly hidden?: true }
```

- **Kanonický tvar** (determinismus, porovnání `toData` při přehrání logu): `setBodyMeta` uloží `name` jen neprázdné a `hidden` jen jako `true`; prázdná metadata záznam odeberou; prázdná mapa → vlastnost `bodies` ve studiu chybí. Barva a průhlednost přibudou jako další pole ([[Q073 Průhlednost a barva těles|Q073]]).
- Změna metadat vytvoří nové `studio` se **stejným** polem `features` i `rollbackIndex`, takže cache regenerace podle identity featur zůstane platná. Ostatní mutátory `bodies` zachovají.
- Dokument tělesa nezná (vznikají regenerací), takže `setBodyMeta` existenci tělesa nekontroluje a záznamy smazaných featur zůstávají: undo smazání vrátí těleso i se jménem a skrytím.
- `fromData`: `studio.bodies` chybí → bez metadat; jinak objekt s klíči přes `parseBodyId` (jinak issue `studio.bodies['<klíč>']`) a hodnotami jen s `name` (neprázdný řetězec) a `hidden` (boolean, `false` se vypustí); jiná vlastnost v hodnotě je issue (přísnost jako u parametrů, [[Q028 Chybějící a přebytečné parametry|Q028]]). Cesty dalších issue: `bodies`, které není objekt → `studio.bodies`; hodnota, která není objekt → `studio.bodies['<klíč>']`; chyba v hodnotě → `studio.bodies['<klíč>'].name` / `.hidden` / `.<cizí klíč>`. Prázdná hodnota `{}` nebo `{ hidden: false }` je platná a kanonizace ji zahodí. Výsledek je v kanonickém tvaru a zmrazený.

## Schéma featury

Datová část typu featury: co za parametry má, jak vypadají výchozí hodnoty a jak se migrují stará data. Chování (výpočet geometrie) je v `regen` ([[0004-data-oddelene-od-chovani|ADR 0004]]).

```ts
export type ParamSpec =
  | { kind: 'length';  label: string; default: number } & Bounds
  | { kind: 'angle';   label: string; default: number } & Bounds
  | { kind: 'number';  label: string; default: number; integer?: boolean } & Bounds
  | { kind: 'boolean'; label: string; default: boolean }
  | { kind: 'enum';    label: string; default: string; options: readonly { value: string; label: string }[] }
  | { kind: 'point';   label: string; default: Vec3 }
  | { kind: 'bodies';  label: string; min?: number; max?: number }            // BodyRef[]
  | { kind: 'topo';    label: string; entity: 'face' | 'edge' | 'vertex'; min?: number; max?: number } // TopoRef[]
  | { kind: 'region';  label: string; min?: number; max?: number };          // SketchRegionRef[]

/** Meze číselného parametru. exclusiveMin/Max = ostrá mez (Q050): { min: 0, exclusiveMin: true } znamená > 0. */
interface Bounds { min?: number; max?: number; exclusiveMin?: boolean; exclusiveMax?: boolean }

export type ParamSchema = Readonly<Record<string, ParamSpec>>;

export interface FeatureSchema<P = unknown> {
  readonly type: string;
  readonly version: number;
  readonly label: string;               // klíč překladu, 'box.label' (ADR 0014)
  readonly icon?: string;               // název ikony Tabler, 'box' (Timeline, M10)
  readonly params: ParamSchema;
  defaults(): P;
  validate(params: unknown): readonly ParamIssue[]; // unknown: parametry z dokumentu jsou neověřené
  migrate?(fromVersion: number, raw: unknown): P;   // povinné, jakmile version > 1 – hlídá registr
}

export interface ParamIssue {
  readonly param: string;                                   // '' = parametry jako celek
  readonly code: string;                                    // klíč překladu, 'param.mustBePositive' (ADR 0014)
  readonly params?: Readonly<Record<string, string | number>>; // hodnoty do textu, např. { min: 0 }
}

export type FeatureSchemaRegistry = Registry<FeatureSchema>;   // klíč = type, viz core
export function createFeatureSchemaRegistry(): FeatureSchemaRegistry;
```

- `validate` bere `unknown`, ne `P`: validace teprve zjišťuje, jestli data odpovídají `P` (stejně jako `fromData`).
- `migrate` je v typu volitelná, protože pravidlo „povinné od verze 2“ závisí na hodnotě. Hlídá ho `register()` registru schémat: verze musí být celé číslo ≥ 1 a schéma s `version > 1` bez `migrate` se odmítne výjimkou už při startu.
- Referenční `ParamSpec` (`bodies`, `topo`, `region`) bez `min`/`max` připouští `0..∞` referencí. Povinnost aspoň jedné reference vyjádří schéma přes `min: 1`.
- Typ entity u `topo` (`face`/`edge`/`vertex`) obecná validace neověřuje – zjistí se až po regeneraci.

- Všechny `label` (u `ParamSpec`, u možností `enum` a u `FeatureSchema`) jsou **klíče překladu**, ne texty. Texty dodává plugin ve slovníku `messages` a překládá je `ui` ([[0014-preklady-vue-i18n-a-klice|ADR 0014]], [[Q070 Překlady textů UI|Q070]]).
- `exclusiveMin`/`exclusiveMax` bez `min`/`max` nemají účinek. Kódy chyb z `validateAgainstSchema`: `param.missing`, `param.unexpected`, `param.wrongType`, `param.notInteger`, `param.belowMin`, `param.atOrBelowMin` (ostrá mez), `param.aboveMax`, `param.atOrAboveMax`, `param.unknownOption`, `param.tooFewRefs`, `param.tooManyRefs`, `param.invalidRef` (`{ index }`), `param.duplicateRef` (`{ index }`, M11). `belowMin`/`atOrBelowMin` a `tooFewRefs` nesou `{ min }`, `aboveMax`/`atOrAboveMax` a `tooManyRefs` `{ max }`, ostatní kódy jsou bez `params`. `param.wrongType` pokrývá i parametry, které nejsou objekt (`param: ''`), a NaN/nekonečno.

`ParamSpec` slouží třem účelům najednou: validaci, generování formuláře v UI ([[11-ui|11]]) a rozpoznání, které parametry jsou reference (pro picking v dialogu).

Pomocná funkce `validateAgainstSchema(schema, params)` dělá obecnou kontrolu (typ, min/max, počet referencí). Schéma featury ji v `validate` zavolá a přidá vlastní pravidla.

- Chybějící parametr (je ve schématu, ne v `params`) i přebytečný parametr (je v `params`, ne ve schématu) je `ParamIssue` ([[Q028 Chybějící a přebytečné parametry|Q028]]). `migrate` proto musí po sobě uklidit i parametry, které nová verze nemá.
- Referenční parametry (`bodies`, `topo`, `region`) jsou v `params` vždy, prázdné jako `[]`, i při `min: 0`.
- Referenční parametr nesmí obsahovat stejnou referenci dvakrát (M11): po kontrole tvaru se hlásí první položka shodná s dřívější (`body` u `body`, `body` + `name` u `topo`, `sketch` + `region` u `region`) jako `param.duplicateRef` s jejím `index`. Pořadí kontrol: `invalidRef`, `duplicateRef`, `tooFewRefs`, `tooManyRefs`. Vztahy mezi parametry (těleso v cílech i nástrojích booleanu) jsou vlastní pravidlo schématu.

## Serializace

```ts
export interface DocumentData {
  readonly meta: DocumentMeta;
  readonly studio: PartStudioData;     // FeatureInstance jsou už čistá JSON data
}

export function toData(doc: DocumentReader): DocumentData;
export function fromData(data: unknown, schemas: RegistryReader<FeatureSchema>): Result<DocumentWriter, DocumentLoadError>;

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

### Migrace dat featur

Migraci parametrů na aktuální verzi schématu používá `fromData` i `ops` (migrace při `apply`, [[04-operace-a-historie#Handler]], [[Q035 Migrace featur v záznamech logu|Q035]]), proto je exportovaná:

```ts
export interface FeatureData { readonly type: string; readonly typeVersion: number; readonly params: unknown }
/** Neznámý typ → beze změny (tentýž objekt). Stejná verze → tentýž objekt. Novější verze → err 'typeVersion'; výjimka migrate nebo výsledek, který není čistý JSON objekt → err 'params'. */
export function migrateFeatureData(schemas: RegistryReader<FeatureSchema>, data: FeatureData): Result<FeatureData, DocumentLoadIssue>;
```

`fromData` cesty prefixuje `studio.features[i].`. Migrovaný výsledek zachová ostatní pole vstupu (`{ ...data, typeVersion, params }`); nezměněná data vrací jako tentýž objekt.

## Testy

- Invarianty mutátorů (duplicitní id, neexistující featura, indexy mimo rozsah).
- Posun rollback baru pro vložení, smazání a přesun před barem, na baru a za barem.
- Strukturální sdílení: po `replaceFeature` jsou ostatní instance `===` původním.
- `toData` → `fromData` → `toData` je identita.
- Migrace: featura s `typeVersion: 1` se načte schématem verze 2.
- `validateAgainstSchema` pro každý `ParamSpec.kind`, chybějící a přebytečný parametr.
- `fromData` s poškozenými daty vrátí `err` s cestou k problému (duplicitní id, `rollbackIndex` mimo rozsah, chybějící vlastnost).
- Metadata těles (M11): kanonizace v `setBodyMeta`, žádný `changed` beze změny, `features` zůstává totéž pole, ostatní mutátory metadata zachovají, `fromData` s platnými i poškozenými metadaty; `param.duplicateRef` pro `bodies` a `topo`.

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
