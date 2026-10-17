---
type: spec
status: implemented
order: 7
aliases:
  - regen – regenerace historie
  - Spec 07
modules:
  - server
milestones:
  - "[[M06-regenerace]]"
  - "[[M11-dalsi-entity]]"
  - "[[M12-skicar]]"
  - "[[M13-extrude-revolve]]"
  - "[[M14-topologicke-pojmenovani]]"
  - "[[M43-regenerace-v-cpp]]"
  - "[[M44.1-builder-skici-na-serveru]]"
  - "[[M47-uklid-a-dokonceni]]"
tags:
  - spec
created: 2026-10-12
updated: 2026-10-17
---
# 07 – Regenerace historie

> **Pojmy:** [[Regenerace]], [[Stav regenerace]], [[Builder featury]], [[Těleso]], [[Rollback bar]], [[Mark and sweep]], [[Neměnná data]]  
> **Rozhodnutí:** [[0006-nemenna-data]], [[0004-data-oddelene-od-chovani]], [[0030-nativni-jadro-pres-grpc|ADR 0030]], [[Rozhodnutí nativního jádra|N40–N46]]  
> **Milník:** [[M06-regenerace]], [[M43-regenerace-v-cpp]], [[M44.1-builder-skici-na-serveru]]  
> **Archiv:** [[07-regenerace v prohlížeči]] (TS regenerace s generacemi, událostmi a `FakeKernel` do M46)

Přehraje featury Part Studia přes geometrické jádro ([[06-geometricke-jadro]]) a vytvoří výsledná tělesa. Tady žije **chování** featur (buildery). Regenerace běží na serveru v C++: `Regenerator` v knihovně `tinycad_regen` (`server/src/regen`, hlavičky `server/src/regen/include/tinycad/regen/`: `regenerator.hpp`, `builder.hpp`, `state.hpp`, `names.hpp`, `body_operation.hpp`, `face_plane.hpp`, `content_version.hpp`) a buildery v knihovně `tinycad_feature_builders` ve složkách `server/src/features/<name>/` vedle schémat ([[Rozhodnutí nativního jádra|N44]]), builder skici v `server/src/features/sketch`. Závisí na `core`, `document` a `kernel`; operace (`ops`) nezná. Jeden `Regenerator` a jedno `OcctKernel` na běhový dokument, volání serializuje sezení ([[Rozhodnutí nativního jádra|N54]]).

**Zápis v této specifikaci:** signatury zůstávají v TypeScriptu jako zápis kontraktu ([[Rozhodnutí nativního jádra|N128]]). C++ se liší formou: regenerace je **synchronní**, bez generací `'superseded'`, událostí a ztraceného jádra ([[Rozhodnutí nativního jádra|N40]]); builder vrací `core::Result<BuildOutput, FeatureError>` místo `Promise` a chybu jádra předá přes `kernelFailure` (status `KERNEL`); `RegenState` je uspořádaný seznam `shared_ptr<const Artifact>` ([[Rozhodnutí nativního jádra|N41]]); `SketchArtifact` nezávisí na modelu skici ([[Rozhodnutí nativního jádra|N42]]).

**Klient** regeneraci nemá. Výsledek (tělesa, statusy featur, kotvy, vstup editované featury, jména ploch) vidí jen přes read model sezení a sítě podle `content_version` ([[14-protokol#Read model a sítě]]); průběh přes `regen_progress` z `RegenObserver::featureDone`.


## Princip

Každá featura je funkce `výstupní stav = f(vstupní stav, parametry)`. Stav je neměnný snímek toho, co existuje po dané featuře:

```ts
export type ArtifactId = BodyId | SketchId | PlaneId | AxisId; // vždy '<vlastník>/<druh>[:<n>]' (ADR 0015); SketchId a PlaneId od M12, AxisId od M13

export interface Body {
  readonly kind: 'body';
  readonly id: BodyId;                               // bodyId(origin, n) z document – jediné místo, kde id vzniká
  readonly origin: FeatureId;                        // featura, jejíž builder id razil; v rodokmenu se nemění
  readonly lastModifiedBy: FeatureId;                // poslední featura, která tělesu dala nový tvar
  readonly shape: ShapeHandle;
  readonly names: NameTable;                         // jména ploch/hran a topologie tohoto tvaru (spec 08), od M14 z nameShape
}

/** Rovina (M12): počáteční roviny vlastníka ORIGIN; později konstrukční roviny. */
export interface PlaneArtifact {
  readonly kind: 'plane';
  readonly id: PlaneId;
  readonly owner: FeatureId;                         // ORIGIN u počátečních rovin
  readonly plane: Plane;                             // z core
}

/** Výsledek skici (M12, spec 12): rovina, vyřešená geometrie pro kresbu, plochy oblastí v jádře a (M30) jejich obrysy. */
export interface SketchArtifact {
  readonly kind: 'sketch';
  readonly id: SketchId;                             // sketchId(owner)
  readonly owner: FeatureId;
  readonly plane: Plane;
  readonly entities: readonly SketchEntity[];        // ze sketch; kresba v render
  readonly regions: ReadonlyMap<string, ShapeHandle>; // jméno oblasti → rovinná plocha (SketchOps.makeFace), v pořadí oblastí
  readonly outlines: readonly ProfileRegion[];        // M30: oblasti z SketchOps.profileRegions ve stejném pořadí a se stejnými jmény jako regions; pro kresbu a picking
}

/** Osa (M13): osy počátku vlastníka ORIGIN; později konstrukční osy. */
export interface AxisArtifact {
  readonly kind: 'axis';
  readonly id: AxisId;
  readonly owner: FeatureId;                         // ORIGIN u os počátku
  readonly origin: Vec3;
  readonly direction: Vec3;                          // jednotkový
}

export type Artifact = Body | SketchArtifact | PlaneArtifact | AxisArtifact;   // diskriminace podle kind

export interface RegenState {
  readonly artifacts: ReadonlyMap<ArtifactId, Artifact>;
}

export const EMPTY_STATE: RegenState;                // od M12 tři PlaneArtifact z ORIGIN_PLANES (document) v pořadí xy, xz, yz, od M13 za nimi tři AxisArtifact z ORIGIN_AXES (x, y, z)
export function bodiesOf(state: RegenState): readonly Body[];   // artefakty druhu body v pořadí mapy
export function sketchesOf(state: RegenState): readonly SketchArtifact[];   // M12
export function planesOf(state: RegenState): readonly PlaneArtifact[];      // M12
export function axesOf(state: RegenState): readonly AxisArtifact[];         // M13
```

Počáteční roviny jsou ve stavu od začátku, takže na ně odkazuje skica stejně jako na kterýkoli jiný artefakt ([[12-skicar#Roviny a počátek]]). `EMPTY_STATE` a jeho artefakty jsou zmrazené.

`RegenState` se mrazí `Object.freeze` jen na úrovni objektu. Mapu artefaktů za běhu nic nehlídá, chrání ji typ `ReadonlyMap` ([[Q048 Neměnnost mapy těles za běhu|Q048]]): stav zapisují jen buildery v repu, ne cizí data. V C++ hlídá neměnnost `const` (`StatePtr` = `shared_ptr<const RegenState>`, [[Rozhodnutí nativního jádra|N41]]); `Object.freeze` níže je zápis TS verze.

Builder mrazí objekt nového stavu i každé nové `Body` (`Object.freeze`), mapu ne. Regenerator stejně mrazí každý `FeatureStatus` (i `FeatureError`) a `RegenResult`; mapu `statuses` chrání typ `ReadonlyMap`. Statusy jdou posluchačům a do UI a zároveň zůstávají v cache.

## Builder featury

```ts
// TS zápis kontraktu; C++: server/src/regen/include/tinycad/regen/builder.hpp (FeatureBuilder::build vrací BuildResult = core::Result<BuildOutput, FeatureError>, synchronně).
// FeatureBuilder<P, A> je u BuildOutput níže (Kotvy manipulátorů).
export interface BuildInput<P> {
  readonly feature: Omit<FeatureInstance, 'params'>;   // id, typ, verze, jméno; builder čte jen id
  readonly params: Evaluated<P>;       // z evaluateParams (03-dokument), jediný zdroj hodnot
  readonly state: RegenState;          // stav před touto featurou
}

/** Část jádra, kterou smí builder používat: tvoří a ptá se, neuvolňuje (Q041). */
export type ModelingKernel = PrimitiveOps & TransformOps & BooleanOps & SketchOps & SweepOps & DressupOps & QueryOps;   // M11 přidal TransformOps a BooleanOps, M12 SketchOps, M13 SweepOps, M14 DressupOps (a QueryOps.topology)

export interface BuildContext {
  /** Sledované jádro: každý vrácený handle patří Regeneratoru (Q041). */
  readonly kernel: ModelingKernel;
  /** Tělesa ze vstupního stavu (artefakty druhu body; jiný druh pod tím id → err); první nevyřešená reference → err (Q044). */
  resolveBodies(refs: readonly BodyRef[]): Result<Body[], RefError>;
  /** Roviny ze vstupního stavu (artefakty druhu plane; chybějící nebo jiný druh → err, první nevyřešená reference), M12. */
  resolvePlanes(refs: readonly (PlaneRef | TopoRef)[]): Result<ResolvedPlane[], RefError>;   // M14: i rovinná plocha tělesa (TopoRef), spec 08
  /** Oblasti skic (M13): artefakt sketchId(ref.sketch) druhu sketch a jméno v jeho regions; první nevyřešená reference → err. */
  resolveRegions(refs: readonly SketchRegionRef[]): Result<ResolvedRegion[], RefError>;
  /** Osa (M13): artefakt druhu axis, nebo úsečka skici (i konstrukční) převedená do světa přes rovinu skici. */
  resolveAxis(ref: AxisRef | SketchEntityRef): Result<ResolvedAxis, RefError>;
  /** Více volání se spojí znakem '\n' do statusu 'warning' (Q045). */
  warn(message: string): void;
  /** Plochy nebo hrany těles podle jména (M14, spec 08): 0 nálezů → err, víc ploch → warn + všechny. */
  resolveTopo(refs: readonly TopoRef[], entity: 'face' | 'edge'): Result<ResolvedTopo[], RefError>;
}

export interface RefError {
  readonly ref: BodyRef | PlaneRef | SketchRegionRef | AxisRef | SketchEntityRef | TopoRef;   // PlaneRef od M12, oblast, osa a entita skici od M13, TopoRef od M14
  readonly message: string;
}

export interface ResolvedRegion { readonly ref: SketchRegionRef; readonly sketch: SketchArtifact; readonly face: ShapeHandle }   // M13
export interface ResolvedAxis { readonly origin: Vec3; readonly direction: Vec3 }   // M13, direction jednotkový
export interface ResolvedPlane { readonly ref: PlaneRef | TopoRef; readonly plane: Plane }   // M14: rovina artefaktu, nebo sketchPlaneOfFace(plocha)
export interface ResolvedTopo { readonly ref: TopoRef; readonly body: Body; readonly indices: readonly number[] }   // M14, indices vzestupně, ≥ 1

/** Rámec roviny skici na rovinné ploše (M14, spec 12): počátek = průmět počátku světa, xDir = průmět +X (při |n·X| ≥ 0,9 průmět +Y). */
export function sketchPlaneOfFace(face: FacePlane): Plane;
/** Totéž co resolvePlanes pro jednu referenci nad hotovým stavem, bez varování; app ho používá pro rovinu editované skici (M14). */
export function planeOfRef(state: RegenState, ref: PlaneRef | TopoRef): Plane | undefined;

export type BuildOutput<A extends FeatureAnchors = FeatureAnchors> =
  | { ok: true; state: RegenState; anchors: A }   // viz Kotvy manipulátorů
  | { ok: false; error: FeatureError };

export interface FeatureBuilder<P = unknown, A extends FeatureAnchors = FeatureAnchors> {
  readonly type: string;
  build(input: BuildInput<P>, ctx: BuildContext): Promise<BuildOutput<A>>;
}

/** Chyba featury pro nevyřešenou referenci parametru param (Q044); hluboce zmrazená. */
export function unresolvedReference(param: string, e: RefError): FeatureError;
// → { code: 'UNRESOLVED_REFERENCE', message: e.message, issues: [{ param, code: 'param.unresolvedRef' }] }

export type BuilderRegistry = Registry<FeatureBuilder>;   // klíč = type, viz core; chybějící builder → find() = undefined
export function createBuilderRegistry(): BuilderRegistry;
```

Pravidla pro builder:
- nesmí mutovat vstupní stav, vrací nový (`new Map(state.artifacts)` + změny),
- dodržuje identitu [[Artefakt|artefaktů]] ([[0015-artefakty-a-identita-telesa|ADR 0015]]): featura, která těleso **vytváří**, razí id `bodyId(feature.id)` (jediné těleso je bez čísla; při více tělesech dostane každé `bodyId(feature.id, n)` s `n` od 1 podle rodokmenu, ne podle pořadí z jádra – `f/body` a `f/body:1` jsou různá id; přesné pravidlo pro Boolean a Transform doplní M11) a nastaví `origin` i `lastModifiedBy` na sebe; featura, která těleso **mění**, zachová `id` i `origin`, nastaví `lastModifiedBy` a od M14 jména přepočítá z historie jádra (`names = await nameShape(…)` se vstupy v pořadí volání jádra, [[08-topologicke-pojmenovani#Tabulka jmen a přenos]]; jméno nezměněné plochy se tak zachová); featura, která těleso **spotřebuje**, ho z mapy odebere (pravidla Transform a Boolean níže),
- nesmí uvolňovat handle (to dělá `Regenerator`),
- všechny tvary vytváří přes `ctx.kernel`, ten každý vrácený handle zapíše do množiny vlastněné Regeneratorem – i mezivýsledky a tvary z builderu, který pak selže ([[Q041 Úklid mezivýsledků builderu|Q041]]),
- očekávanou chybu vrací jako `{ ok: false }` (nevyřešenou referenci přes `unresolvedReference(param, e)` jako `UNRESOLVED_REFERENCE` s `issues`, aby ji UI přeložilo u parametru, [[Q044 RefError a nevyřešené reference|Q044]]), výjimky jádra může nechat proletět – `Regenerator` je převede na chybu featury `KERNEL`. Výjimka, která z jádra nepochází (`kernelErrorCode(e) === undefined`), je chyba programu: `run` po úklidu handle odmítne s touto výjimkou ([[Q043 Výjimka builderu mimo jádro|Q043]]), V C++ builder výjimky jádra nedostává: metoda jádra vrátí `KernelResult` a builder chybu předá jako `core::fail(kernelFailure(r.error()))` (status `KERNEL`), nebo ji převede sám (fillet, chamfer, `extrude.upToFace`); výjimka z builderu je chyba programu ([[Rozhodnutí nativního jádra|N40]]).
- validaci parametrů neřeší – `Regenerator` před voláním builderu zavolá `evaluateParams` ([[03-dokument#Vyhodnocení parametrů]]) a při problému builder vůbec nespustí (status `INVALID_PARAMS`). Builder dostane jen vyhodnocené parametry `input.params`; `input.feature` je typově bez `params`, takže surové hodnoty nečte (za běhu je to tentýž objekt featury, hlídá to typ).

**Identita u featur, které tělesa mění** ([[M11-dalsi-entity|M11]], [[0015-artefakty-a-identita-telesa|ADR 0015]]):

- **Transform:** (M19, schéma verze 3: rotace `rx`, `ry`, `rz` místo `axis` a `angle`, matice `T(translate) · T(p) · Rz · Ry · Rx · T(−p)`, `migrate(2)` přesune `angle` do úhlu podle `axis` a ostatní nastaví na 0 (neznámou nebo chybějící `axis` propustí beze změny, chybu ohlásí `validate`), `migrate(1)` projde v1 → v2 → v3; podrobně [[M19-manipulator-fusion#4. Transformace v3|M19]]) (M18, schéma verze 2: `pivot` `'bodiesCenter' | 'origin' | 'point'` a `pivotPoint`; `p` = střed sjednocené obálky vstupních těles, počátek, nebo `pivotPoint`; matice `T(translate) · T(p) · R · T(−p)`; kotva `pivot` jen pro `bodiesCenter` (počátek a `pivotPoint` počítá manipulátor z params); `migrate(1)` doplní `pivot: 'origin'`, `pivotPoint: [0, 0, 0]` a data, která nejsou objekt, odmítne výjimkou; podrobně [[M18-manipulatory#6. Transformace v2|M18]]) každé vybrané těleso zůstane pod svým `id` a na svém místě v mapě, zachová `origin`, dostane nový `shape`, `names` z `nameShape` (identita – jména stejná) a `lastModifiedBy` = transform. Ostatní artefakty beze změny.
- **Boolean:** výsledek je **jedno** těleso `{ ...první cíl, shape, names, lastModifiedBy: boolean }` – dědí `id`, `origin` a místo v mapě prvního cíle, `names` z `nameShape` se vstupy v pořadí volání jádra (cíle, pak nástroje; u `union` první cíl, pak ostatní cíle a nástroje). Ostatní cíle a nástroje z mapy zmizí; s `keepTools` nástroje zůstanou beze změny (tentýž objekt). Jádro vrátí jeden handle i pro nesouvislý výsledek (compound více solidů). Rozpad výsledku na více těles `bodyId(cíl.origin, n)` podle rodokmenu z historie jádra (`Generated`/`Modified`, ne pořadí výstupu) byl úkol M14, znovu odložený do [[M15-export-a-dokonceni|M15]] ([[Rozhodnutí noční rychloakce#M11 – Další entity|R8]] ⚠, [[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R100]] ⚠).
- **Fillet a Chamfer** (M14): hrany se seskupí podle tělesa (pořadí prvního výskytu v parametru), na každé těleso jedno volání `fillet`/`chamfer` se všemi jeho hranami; těleso zachová `id`, `origin` a místo v mapě, dostane `shape`, `names` z `nameShape` (`generatedTag` `'fillet'`/`'chamfer'`) a `lastModifiedBy` = featura. Chyba jádra `operation-failed` z volání `fillet`/`chamfer` (příliš velký poloměr, hrana, kterou OCCT nepřijme) → `INVALID_PARAMS` s `issues [{ param: 'radius', code: 'fillet.failed' }]`, resp. `distance` a `chamfer.failed`, s přeloženým textem pluginu. Ostatní chyby jádra zůstávají `KERNEL` ([[M19.1-opravy-z-revize|M19.1]], D6). `INVALID_PARAMS` tak nenese jen problémy ze `schema.validate`, ale i z builderu (stejně jako `extrude.upToFace`).
- Změna parametru featury, ze které těleso pochází, ani nástroje booleanu id výsledku nemění (id je rodokmen, ne pořadí výstupu jádra).
- **Jedno místo pro pravidlo identity** (M14, oprava revize): buildery, které tělesa mění nebo spotřebovávají (Transform, Boolean, Fillet, Chamfer i `applyBodyOperation`), ho neopisují, ale volají dva pomocníky z `regen` – pluginy se navzájem importovat nesmí, takže sdílený kód patří sem:

```ts
/** Změněné těleso: id, origin zůstanou, names = nameShape(result, inputs, generatedTag), lastModifiedBy = feature; zmrazené. */
export function modifyBody(p: { kernel: Pick<QueryOps, 'topology'>; feature: FeatureId; body: Body; result: ShapeResult; inputs: readonly NameTable[]; generatedTag?: string }): Promise<Body>;
/** Nový stav v pořadí state: tělesa z changed na místě svého id, tělesa z consumed vypadnou (consumed vyhrává), zbytek tentýž objekt; id, které ve state není, se nepřidá; zmrazené. */
export function replaceBodies(state: RegenState, changed: ReadonlyMap<BodyId, Body>, consumed: ReadonlySet<BodyId>): RegenState;
```
- **Vysunutí a Rotace** (M13): podle operace featury, viz [[#Operace tělesa (M13)]].

### Kotvy manipulátorů (M18)

[[Kotva manipulátoru|Kotvy]] jsou geometrie pro úchyty [[Manipulátor|manipulátorů]], kterou zná jen builder ([[0021-manipulatory-kotvy-z-regenerace|ADR 0021]]).

```ts
/** Bod a volitelný jednotkový směr ve světových souřadnicích. */
export interface Anchor { readonly point: Vec3; readonly direction?: Vec3 }
/** Kotvy jedné featury podle jména ('pivot', 'base'…); jména a význam určuje plugin. */
export type FeatureAnchors = Readonly<Record<string, Anchor>>;
```

- Každý builder vrací při úspěchu `anchors` (povinné pole). Featura bez manipulátoru vrací `{}`. Typ kotev `A` byl do M47 společný builderu i deskriptoru úchytů jednoho pluginu (`FeaturePlugin<P, A>`, dodatek k [[0021-manipulatory-kotvy-z-regenerace|ADR 0021]]), takže překlep ve jménu kotvy byl chyba typu. Od M47 builder běží v C++ a kotvy přichází v read modelu; typ kotev v klientovi je v `src/features/<name>/anchors.ts` a čte ho jen deskriptor úchytů ([[Rozhodnutí nativního jádra|N123]]). Shodu jmen kotev C++ builderu s typem v klientovi hlídají sdílené případy `regen` (pole `anchors`), ne kompilátor. Kotvy, které někdy nejsou, jsou v typu nepovinné (`TransformAnchors = { pivot?: Anchor }`, `ExtrudeAnchors = { base?: Anchor }`; Extrude `upToFace` vrací `{}`). Hlídá to typ, ne komentář: dřív bylo pole volitelné a Transformace s pivotem `origin` nebo `point` kotvy nevracela, takže manipulátor zmizel.
- (Do M47:) Typová kontrola shody byla úplná pro deskriptor zapsaný přímo v pluginu. Samostatně typovaný deskriptor s jiným typem kotev, který s builderem sdílí aspoň jedno jméno, mohl překlep v dalším jménu propustit (TypeScript tu nemá invariantní generika bez ztráty registrovatelnosti).
- **Invariant:** kotva smí záviset jen na vstupech, které úchyty featury netáhnou (pivot Transformace nezávisí na `translate` ani na `rx`, `ry`, `rz`, základna Extrude nezávisí na `distance`). Hlídají ho testy pluginu. Výjimka (M19): úchyty pivotu zapisují `pivot: 'point'`, a tím kotvu `pivot` zruší. Neškodí to, protože pro `'point'` čte `frame()` bod z params, ne z kotvy, a během tahu platí kotvy zmrazené při stisku.
- **Kotva je co nejmenší** (revize M18): nese jen to, co z params spočítat nejde (vyřešené reference, obálky, roviny skic). Co jde spočítat z params (`flip`, `endType`, `pivotPoint`), počítá až `frame()` z živých params, aby úchyt po změně v dialogu nečekal na regeneraci.
- `Regenerator` kotvy **hluboce zmrazí** (`Object.freeze` na mapě jmen, každé kotvě a jejích vektorech) a uloží je do záznamu cache featury vedle stavu a statusu. Featura převzatá z cache tak má kotvy z posledního výpočtu bez volání builderu.
- `RegenResult.anchors` obsahuje kotvy každé featury před rollback barem se statusem `ok` nebo `warning` (z výpočtu i z cache), featura bez manipulátoru s `{}`. Chybná, potlačená a `rolledBack` featura v mapě není.
- Kotvy nenesou handle tvaru, jen čísla. Sweep ani úklid handle se jich netýká.

### Operace tělesa (M13)

Featury, které ze skici staví nový tvar (Vysunutí, Rotace, později Sweep a Loft), ho podle parametru `operation` buď přidají jako nové těleso, nebo jím upraví cílová tělesa. Pravidlo identity je pro všechny stejné, proto je to jedna funkce v `regen`, ne kód v každém pluginu ([[Rozhodnutí noční rychloakce#M13 – Extrude a Revolve|R65–R67]]):

```ts
export type BodyOperation = 'new' | 'add' | 'remove' | 'intersect';
export function applyBodyOperation(p: {
  readonly kernel: ModelingKernel;              // ctx.kernel – mezivýsledky sleduje Regenerator
  readonly state: RegenState;
  readonly feature: FeatureId;
  readonly op: BodyOperation;
  readonly shapes: readonly ShapeResult[];      // nové tvary featury (hranol na oblast) i s rolemi, ≥ 1 (M14: ShapeResult místo ShapeHandle)
  readonly targets: readonly Body[];            // vyřešená cílová tělesa; ≥ 1 pro jiné operace než 'new', u 'new' ignorovaná
}): Promise<RegenState>;
```

- **`new`:** jeden tvar = tvar tělesa, víc tvarů → `boolean('union', [první], ostatní)` (oddělené tvary dají compound jednoho tělesa jako R8 ⚠). Nové těleso `bodyId(feature)`, `origin` i `lastModifiedBy` = featura, na konec mapy.
- **`add`:** `boolean('union', [cíl₁], [ostatní cíle…, tvary…])`; výsledek dědí `id`, `origin` a místo v mapě prvního cíle, `names` přepočítané z historie booleanu (M14), `lastModifiedBy` = featura; ostatní cíle z mapy zmizí (jako Boolean union).
- **`remove`** a **`intersect`:** pro **každý** cíl zvlášť `boolean('subtract' | 'intersect', [cíl], tvary)`; každý cíl zachová `id`, `origin` i místo v mapě, dostane `names` přepočítané z historie booleanu (M14), `lastModifiedBy` = featura. Cíle se tak neslijí do jednoho tělesa. Obě větve přes `modifyBody` a `replaceBodies`.
- **Jména** (M14): každý tvar z `shapes` se pojmenuje `nameShape` s rolemi z jádra a vstupy `EMPTY_NAMES` za každý vstup, na který jeho historie odkazuje (plocha profilu; prázdný seznam by porušil pravidlo 8 spec 08, [[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R120]]), výsledek booleanu `nameShape` se vstupy v pořadí volání jádra; u `new` s jediným tvarem jsou jména tělesa jména hranolu.
- Prázdný výsledek (odebrání celého cíle, prázdný průnik) je chyba jádra `'operation-failed'` → featura `KERNEL` (Onshape by těleso smazal; R67 ⚠).
- Mezivýsledky (hranoly) ve stavu nezůstanou, takže je sweep uvolní. Výsledná tělesa i stav jsou zmrazené. `shapes` prázdné nebo chybějící cíle u `add`/`remove`/`intersect` → výjimka (chyba programu; schéma má `min: 1`).

**Vysunutí** (`features/extrude`, M13, M14) – parametry v pořadí schématu (`version: 1`):

```ts
export interface ExtrudeParams {
  readonly regions: readonly SketchRegionRef[];                    // min 1; směr = normála roviny skici první oblasti
  readonly operation: 'new' | 'add' | 'remove' | 'intersect';      // viz výše
  readonly targets: readonly BodyRef[];                            // min 1, viditelné jen pro operation ≠ 'new'
  readonly endType: 'blind' | 'symmetric' | 'upToFace';            // 'upToFace' od M14 (R109 ⚠)
  readonly distance: number;                                       // > 0, viditelné jen když distanceApplies(endType) (≠ 'upToFace')
  readonly upTo: readonly TopoRef[];                               // topo 'face', min 1, max 1, viditelné jen pro 'upToFace' (M14)
  readonly flip: boolean;                                          // viditelné jen když flipApplies(endType) (= 'blind')
}
export function flipApplies(endType: unknown): boolean;            // predikáty pro visibleWhen i builder; berou neověřené hodnoty
export function distanceApplies(endType: unknown): boolean;
```

- Jeden hranol na oblast v pořadí oblastí (`extrude(plocha, d̂, délka)`), pak `applyBodyOperation`. Skrytý parametr builder nečte (`flip` jen u `blind`, `distance` ne u `upToFace`), takže stará data bez `upTo` jsou platná bez migrace.
- **`symmetric`:** plocha oblasti posunutá o `−distance/2 · d̂`, hranol délky `distance`.
- **`upToFace`** (M14): rovina plochy přes `resolvePlanes(upTo)` (plocha s nejmenším indexem jména, víc ploch → varování `…; the first is used`); chybějící těleso, jméno i **nerovinná plocha** → `unresolvedReference('upTo', e)` = `UNRESOLVED_REFERENCE` (odchylka od plánu Ú11, který čekal `INVALID_PARAMS`; jedna cesta s rovinou skici na ploše). Plocha nerovnoběžná se skicou (`|n̂ · d̂| < 1 − 1e-9`) nebo pro některou oblast ne ve směru vysunutí (délka `(rovina.origin − oblast.origin) · d̂ ≤ 1e-9`) → `INVALID_PARAMS` s `issues [{ param: 'upTo', code: 'extrude.upToFace' }]`. Délka hranolu se počítá pro každou oblast zvlášť.

`resolveTopo` a `resolvePlanes` s `TopoRef` hlásí chybějící těleso (`Body '<b>' does not exist`, `'<b>' is not a body`), chybějící jméno (`Face '<jméno>' not found on body '<b>'`, `Edge …`) a nerovinnou plochu (`Face '<jméno>' is not planar`); víc ploch pod jedním jménem → `warn` – u `resolveTopo` `Reference '<jméno>' matches <n> faces; all are used`, u `resolvePlanes` plocha s nejmenším indexem a `…; the first is used` ([[08-topologicke-pojmenovani#Reference ve featurách]], R120). `resolveRegions` hlásí `Sketch '<f>' not found` (artefakt chybí nebo je jiného druhu) a `Region '<jméno>' of sketch '<f>' not found`. `resolveAxis` hlásí chybějící osu, chybějící skicu nebo entitu, entitu jiného druhu než `line` (`Sketch entity '<id>' is not a line`) a úsečku nulové délky. Builder je převede přes `unresolvedReference(param, e)`.

Příklad: Buildery v C++: `server/src/features/<name>/builder.cpp` (např. `server/src/features/box/builder.cpp`).

```ts
export const boxBuilder: FeatureBuilder<BoxParams> = {
  type: 'box',
  async build({ feature, state }, { kernel }) {
    const { origin, width, depth, height } = feature.params;
    const r = await kernel.makeBox({ origin, size: [width, depth, height] });
    const id = bodyId(feature.id);   // z document: jediné místo, kde BodyId vzniká (ADR 0015)
    const names = await nameShape({ kernel, featureId: feature.id, result: r, inputs: [] });   // role kvádru → '<fid>/face:top'… (M14)
    const body: Body = { kind: 'body', id, origin: feature.id, lastModifiedBy: feature.id, shape: r.shape, names };
    return { ok: true, state: { artifacts: new Map(state.artifacts).set(id, body) } };
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
  readonly code: 'INVALID_PARAMS' | 'UNRESOLVED_REFERENCE' | 'KERNEL' | 'UNKNOWN_TYPE' | 'STALE_VERSION';
  readonly message: string;                      // technický text (log, chyby jádra)
  readonly issues?: readonly ParamIssue[];       // INVALID_PARAMS: problémy z schema.validate (M10, ADR 0014); UNRESOLVED_REFERENCE: [{ param, code: 'param.unresolvedRef' }] (M11);
                                                 // KERNEL (M19.2): [{ param: '', code: 'kernel.operationFailed' | 'kernel.invalidInput' | 'kernel.internal' }], nebo issues builderu
}
```

Status featury určí `Regenerator` v tomto pořadí:

1. pozice `>= rollbackIndex` → `rolledBack` (builder se nevolá, v cache zůstává, co tam bylo),
2. `suppressed` → `suppressed`, stav se propustí,
3. chybí schéma nebo builder pro `type` → `error` `UNKNOWN_TYPE`,
4. `feature.typeVersion !== schema.version` → `error` `STALE_VERSION` (pojistka pro data, která obešla migraci, [[04-operace-a-historie#Migrace dat featur]]; `message` nese obě verze), builder se nevolá,
5. `evaluateParams(schema, params, NO_VARIABLES)` vrátí problémy → `error` `INVALID_PARAMS` s `issues` (zmrazená kopie) a technickou `message` `'param: code; …'`, builder se nevolá. UI chybu překládá z `issues`, ne z `message` (rozhodnutí 2026-10-13),
6. builder vrátí `{ ok: false }` → `error` s jeho chybou; výjimka s kódem jádra → `error` `KERNEL` s technickou `message` a od M19.2 ([[M19.2-ux-backlog|D9]]) s `issues: [{ param: '', code }]` podle `kernelErrorCode`: `'operation-failed'` → `kernel.operationFailed`, `'invalid-input'` → `kernel.invalidInput`, jinak `kernel.internal`. UI tak ukáže přeložený text a technickou zprávu jen v „Podrobnostech“ (`TreeRow.detail`, [[10-interakce#Strom featur: `FeatureTreeModel`]]). Builder, který chybu jádra převede sám (fillet, chamfer, `extrude.upToFace`), vrací `{ ok: false }` s vlastními issues, a ta mají přednost,
7. builder vrátil stav a volal `warn` → `warning`, jinak `ok`.

`pending` Regenerator nevrací, používá ho UI před první regenerací.

Regenerator předpokládá, že parametry jsou ve verzi aktuálního schématu – migraci (`typeVersion` → `schema.version`) dělá `fromData` při načtení ([[03-dokument]]) a handlery operací při `apply` ([[04-operace-a-historie#Migrace dat featur]]); co migraci obešlo, chytí krok 4 (`STALE_VERSION`).

Pád jádra se ztrátou všech handle (dřív `RpcError` `'disconnected'` po pádu workeru, [[Q049 Pád jádra během regenerace|Q049]]) na serveru nenastává: jádro je v procesu serveru a vrací chyby jako hodnoty ([[Rozhodnutí nativního jádra|N40]]). Původní pravidlo: [[07-regenerace v prohlížeči]].

Když `run` odmítne kvůli výjimce mimo jádro ([[Q043 Výjimka builderu mimo jádro|Q043]]), cache se nezapíše a zůstane z předchozího běhu. Handle vytvořené v přerušeném běhu proto nejsou živé a sweep je uvolní.

**Chybná featura propouští stav beze změny** (chová se jako no-op), následující featury se přepočítají normálně. Je to chování Onshape: jedna červená featura nerozbije zbytek modelu, pokud na ní nic nezávisí.

## Regenerator

```ts
// TS zápis kontraktu; C++: server/src/regen/include/tinycad/regen/regenerator.hpp
export interface Regenerator {
  /** Přepočítá studio, synchronně (N40); sezení volání serializuje, nahrazení běhu neexistuje. */
  run(studio: PartStudioData, opts?: { readonly inputOf?: FeatureId }): RegenResult;
  /** Pozorovatel průběhu pro další běhy (null = žádný); sezení z něj dělá regen_progress. */
  setObserver(observer: RegenObserver | null): void;
  /** content_version tělesa ze stavu tohoto Regeneratoru (N43). */
  contentVersion(body: Body): string;
  /** Vlastněné handle (testy: po běhu = živé handle). */
  ownedHandleCount(): number;
}

export interface RegenObserver {
  /** Každá featura studia právě jednou, v pořadí featur. */
  featureDone(generation: number, featureId: FeatureId, status: FeatureStatus): void;
}

export function createRegenerator(deps: {
  kernel: GeometryKernel; builders: RegistryReader<FeatureBuilder>; schemas: RegistryReader<FeatureSchema>;   // jen čtení (ADR 0011); musí přežít Regenerator
  now: () => number;                // hodiny pro durationMs (Q046): server dodá monotónní hodiny, testy pevné
}): Regenerator;

export interface RegenResult {
  readonly generation: number;
  readonly finalState: RegenState;                 // stav na rollback baru
  readonly statuses: ReadonlyMap<FeatureId, FeatureStatus>;
  readonly anchors: ReadonlyMap<FeatureId, FeatureAnchors>;   // viz Kotvy manipulátorů
  /** Vstup featury opts.inputOf (stav před ní), null bez inputOf nebo když featura před lištou není (ADR 0025). */
  readonly input: { readonly feature: FeatureId; readonly state: RegenState } | null;
  readonly durationMs: number;
}
```

- **Generace:** `generation` je jen čítač běhů (1 pro první, +1 za každý) pro read model a průběh; běh se nikdy nenahrazuje. `started` a `finished` z TS verze jsou volání a návrat `run`. Souběh generací, `'superseded'` a události TS verze: [[07-regenerace v prohlížeči]].
- **Vstup editované featury** ([[0025-vstupni-stav-editovane-featury|ADR 0025]]): `input.state` je `entries[i-1]?.state ?? EMPTY_STATE` featury `inputOf` na pozici `i < rollbackIndex`, i když je potlačená, v chybě nebo vzatá z cache. Je to tentýž objekt, který dostal její builder, nic se nepočítá navíc. Handle vstupu jsou živé, protože mark & sweep drží všechny stavy cache. `app` ho předává při otevřené session dialogu featury.

### Cache podle identity

Regenerator si pamatuje pro každou pozici `i` trojici *(instance featury, výstupní stav, status)*, od M18 navíc kotvy featury ([[Q042 Obsah cache regenerace|Q042]]). Cache obsahuje i chybné a suppressed featury, ne však `rolledBack`. Při `run`:

1. Projde featury od začátku a najde první index `k`, kde `features[i] !== cache[i].feature` (porovnání **identity objektu**). Díky neměnným datům změna parametru, vložení, smazání i přesun featury automaticky změní identitu na dané pozici nebo posune pole. ([[0006-nemenna-data|ADR 0006]])
2. Cache `0..k-1` platí. Stav před `k` je `cache[k-1].state` (nebo `EMPTY_STATE`).
3. Přepočítá featury `k .. rollbackIndex-1`. Suppressed featury jen propustí stav.
4. Featury za rollback barem dostanou status `rolledBack`, nepočítají se.
5. Nová cache = `cache[0..k-1]` + záznamy nově spočítaných featur `k..rollbackIndex-1`. Když `k >= rollbackIndex`, nepočítá se nic a cache se jen zkrátí na `0..k-1`, takže záznamy za barem, které stále platí, zůstanou.

Posun rollback baru dopředu tak přepočítá jen nově zahrnuté featury, posun dozadu nepočítá nic.

### Životnost handle: mark & sweep

Stavy sdílejí handle (těleso, které featura nezměnila, prochází dál se stejným handle). Počítání referencí by bylo křehké, proto:

1. Po každé dokončené regeneraci se projdou všechny stavy v cache a posbírá se množina **živých** handle: `shape` artefaktů druhu `body` a od M12 všechny hodnoty `regions` artefaktů druhu `sketch` (roviny a osy handle nemají). Hlídá to test sweepu.
2. Všechny handle, které Regenerator kdy dostal od jádra a nejsou živé, se uvolní (`kernel.release`).
3. Zničení `Regeneratoru` uvolní všechny handle, které ještě vlastní.

Regenerator proto vede množinu „vlastněných“ handle. Plní ji sledované jádro v `BuildContext` ([[Q041 Úklid mezivýsledků builderu|Q041]]). Test ověří, že po sekvenci změn platí `kernel.liveHandleCount() === počet živých`.

Sweep běží na konci každého `run`, i když `run` skončí výjimkou z builderu nebo pozorovatele (chyba programu, [[Q043 Výjimka builderu mimo jádro|Q043]]; cache se pak nezapíše a výjimka letí dál). Všechny nepotřebné handle se uvolní **jedním** voláním `kernel.release`, sweep je součástí `durationMs`. Když `release` selže ([[Q040 Selhání release při úklidu handle|Q040]]):

- `'unknown-handle'` – chyba programu (regen vlastnil handle, který jádro nezná): `AssertionError`. `release` je atomický, handle zůstanou ve vlastněné množině,
- jiný kód jádra (`'internal'`) – handle zůstanou ve vlastněné množině a zkusí se při příštím sweepu, `run` skončí normálně.

Klient handle nevidí: sítě těles dostává z read modelu podle `content_version` ([[Rozhodnutí nativního jádra|N43]]), takže uvolnění handle a vykreslení se nepotkají. Pravidla úklidu při souběhu generací a po pádu jádra z TS verze: [[07-regenerace v prohlížeči]].

## Testy

C++ testy v `server/test/regen/` (GoogleTest) běží nad skutečným `OcctKernel` s dekorátorem `CountingKernel` z testovací podpory `server/test/regen/testing.hpp`: počítá volání jádra podle metody a umí vložené selhání `failNext` ([[Rozhodnutí nativního jádra|N45]]); C++ `FakeKernel` není. Rozpis TS testů s `FakeKernel`: [[07-regenerace v prohlížeči#Testy (s `FakeKernel`)]].

- `regenerator_test.cpp`: cache podle identity (změna featury 3 z 5 přepočítá jen 3–5, posun rollback baru nevolá jádro), chybná featura propustí stav, `INVALID_PARAMS`, `UNKNOWN_TYPE`, `STALE_VERSION`, potlačená featura, statusy z cache, `warn`, výjimka jádra → `KERNEL` s issue, výjimka builderu → sweep a výjimka dál, mezivýsledek chybného builderu se uvolní, selhání `release`, `durationMs` z pevných hodin, pozorovatel `featureDone`.
- `regenerator_anchors_test.cpp` (kotvy M18), `regenerator_input_test.cpp` (vstup editované featury, ADR 0025), `regenerator_sweep_test.cpp` (živé handle těles a oblastí skic, `liveHandleCount`).
- `regenerator_property_test.cpp`: regenerace s cache = regenerace od nuly a po náhodné sekvenci změn `liveHandleCount == ownedHandleCount`, po zničení Regeneratoru 0 handle ([[Rozhodnutí nativního jádra|N112]]).
- `state_test.cpp`, `builder_test.cpp`, `build_context_test.cpp` (`resolve*`, `unresolvedReference`), `tracking_kernel_test.cpp`, `body_operation_test.cpp` (`applyBodyOperation`, `modifyBody`, `replaceBodies`), `face_plane_test.cpp` (`sketchPlaneOfFace`, `planeOfRef`), `names_test.cpp` a `name_shape_test.cpp` (spec 08), `content_version_test.cpp` (N43). Extrude a Revolve nad `aSketchArtifact` ([[Rozhodnutí nativního jádra|N46]]).
- Buildery featur: `server/test/features/`.
- **Sdílené případy `regen`** (`test/shared-cases/regen/*.json`, 48 případů po úkolu 1 M47), spouštěč `server/test/shared-cases/regen_cases_test.cpp`: uložený dokument se zabudovanými schématy, jedna regenerace od nuly novým `Regeneratorem` nad novým `OcctKernel` ([[Rozhodnutí nativního jádra|N111]]), popis výsledku porovnaný s `expected`. Pokrývají featury, chyby, rollback, potlačení, vstup editované featury, topologické pojmenování ([[08-topologicke-pojmenovani#Scénáře, které musí fungovat (akceptační testy M14)]]) a regrese skici (spline, text, vzor). TS běžec `regen` zmizel; `expected` nových případů se zapisuje ručně podle výstupu C++ ([[Rozhodnutí nativního jádra|N124]], [[13-testovani]]).


## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
