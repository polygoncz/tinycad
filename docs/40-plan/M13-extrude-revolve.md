---
type: milestone
status: todo
order: 13
aliases:
  - M13
  - M13 Extrude a Revolve
modules:
  - document
  - kernel
  - kernel-occt
  - regen
  - interaction
  - render
  - features
  - app
  - ui
specs:
  - "[[06-geometricke-jadro]]"
  - "[[12-skicar]]"
  - "[[03-dokument]]"
  - "[[07-regenerace]]"
  - "[[09-vykreslovani]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
depends_on:
  - "[[M12-skicar]]"
started: 
finished: 
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-14
---
# M13 – Extrude a Revolve

**Cíl:** tělesa ze skici. Vysunutí (Extrude) a Rotace (Revolve) oblastí skici s operací nové těleso / přidat / odebrat / průnik; podmíněné parametry v dialogu, osy počátku, výběr oblasti ve viewportu i v Prohlížeči.

**Specifikace:** [[06-geometricke-jadro|06]] (`SweepOps`), [[07-regenerace|07]] (osy, `resolveRegions`, `resolveAxis`, operace tělesa), [[03-dokument|03]] (podmíněné parametry, druh `axis`, osy počátku), [[10-interakce|10]] (pole a picking oblasti a osy, Prohlížeč, Q069), [[09-vykreslovani|09]] (výplň a picking oblasti), [[11-ui|11]] (pole osy, skupiny, úniková cesta pro vlastní dialog), [[12-skicar|12]] (profily)

**Navazuje na:** [[M12-skicar]] – plán začíná **po sloučení M12** (modul `sketch`, `SketchArtifact.regions`, `SketchOps.makeFace`, `PlaneRef`, druhy `planes` a `data`, režimy, `SketchEditor`, `SketchDrawing`, `solver-planegcs`, `createInThreadPlanegcsSolver`).

**Rozhodnutí** (noční rychloakce, bez Pavla): R61–R83 v [[Rozhodnutí noční rychloakce#M13 – Extrude a Revolve]], [[Q069 Smí nástroj otevřít vlastní transakci|Q069]] (zúžení `ToolContext.ops`).

## Úkoly

- [ ] Ú1 `document`: podmíněné a seskupené parametry, druh `axis`, reference na osu a entitu skici, osy počátku
- [ ] Ú2 `kernel`, `kernel-occt`, `regen`: `SweepOps.extrude` a `revolve`, OCCT v Node pro testy
- [ ] Ú3 `interaction` (+ zástupné místo v `render`, `app`): porty – oblast skici v pickingu a kresbě, oblasti v portu regenerace, zúžení `ToolContext.ops` (Q069)
- [ ] Ú4 `regen`: osy počátku v `EMPTY_STATE`, `resolveRegions`, `resolveAxis`, `applyBodyOperation`
- [ ] Ú5 `render`: výplň a picking oblastí skici
- [ ] Ú6 `interaction`: skryté a seskupené parametry v dialogu, picking oblasti a osy do parametru, kresba oblastí, os a konstrukčních čar, zvýraznění vybraných oblastí
- [ ] Ú7 `interaction`: Prohlížeč – osy počátku a oblasti skici
- [ ] Ú8 `features/extrude`: plugin Vysunutí
- [ ] Ú9 `features/revolve`: plugin Rotace
- [ ] Ú10 `app`, `ui`: registrace pluginů, pole osy, skupiny a skrytá pole v dialogu, úniková cesta pro vlastní dialog, Prohlížeč, lišta, překlady
- [ ] Ú11 `tests`: integrační scénáře (změna kóty, díra v OCCT, rotace v OCCT)
- [ ] Ú12 `e2e`: akceptační scénář s OCCT a planegcs v prohlížeči
- [ ] Ú13 hlavní sezení: kontrola, vault, `architecture-reviewer`, retrospektiva

## Akceptační kritéria

- **Obdélník → vysunutí → změna kóty ve skice → vysunutí se přepočítá:** skica s obdélníkem 40 × 20 a dvěma kótami, „Vysunutí“ s oblastí obdélníku a vzdáleností 10 dá jedno těleso s bbox `[0, 40] × [0, 20] × [0, 10]`; po změně kóty šířky na 60 a „Hotovo“ má totéž těleso (stejné `BodyId`) bbox `[0, 60] × …`, bez chyby featury (integrační test s `FakeKernel` a skutečným řešičem; v e2e Timeline bez chyby a jedno těleso v Prohlížeči).
- **Kružnice → vysunutí odebrat z kvádru → díra:** kvádr 10 × 10 × 10, skica na XY s kružnicí r = 2 uvnitř, „Vysunutí“ s operací „Odebrat“ a cílem kvádr → těleso kvádru (stejné `BodyId`, `lastModifiedBy` = vysunutí) má v OCCT 7 ploch a objem `1000 − 40π` (1 %); hranol mezivýsledku po regeneraci není živý (integrační test s OCCT v Node; v e2e bez chyby a stále jedno těleso).
- **Rotace:** obdélník na rovině XZ (`x ∈ [5, 10]`, `z ∈ [0, 10]`) kolem osy počátku Z o 360° → v OCCT 4 plochy a objem `750π` (1 %).
- **Podmíněné parametry:** v dialogu vysunutí je „Sloučit s“ vidět jen pro operace přidat/odebrat/průnik, „Opačný směr“ jen pro „Do vzdálenosti“; skrytý parametr neblokuje validaci ani nevytváří závislost.
- Celý dialog je v logu jeden záznam; undo/redo a reload vrátí model.
- `npm run check`, `npm run test:integration`, `npm run build`, `npm run test:e2e` zelené.

## Úkoly z M12 (doplněno 2026-10-14)

Odloženo z [[M12-skicar]] (rozhodnutí v [[Rozhodnutí noční rychloakce#M12 – Skicář]]). Zapracováno do Implementačního plánu:

- [ ] `BuildContext.resolveRegions(refs: readonly SketchRegionRef[])` nad `SketchArtifact.regions`; Extrude bere `ShapeHandle` plochy, ne data (`ProfileInput` ze spec 06 odpadá). → Ú2 (port bere handle, R61), Ú4.
- [ ] Pole parametru `region` v UI a picking oblasti skici ve viewportu. → Ú3, Ú5, Ú6, Ú7, Ú10. **Upraveno:** pole ukazuje jen počet, čipy oblastí nejsou (R77 ⚠); vybrané oblasti zvýrazní viewport (R76); oblasti jdou vybrat i v Prohlížeči (R75).
- [ ] Osy počátku jako artefakty (`origin/axis:x|y|z`, R37) a osa Revolve jako reference na osu nebo úsečku skici. → Ú1, Ú4, Ú6, Ú7, Ú9 (R71, R72, R73).

## Úkoly z revize architektury (doplněno 2026-10-13, [[M10.1-zpevneni-kostry]])

Nález 7 z [[Revize architektury 2026-10-13]]: schéma parametrů bez podmínek nestačí na Extrude. Zapracováno do Implementačního plánu (2026-10-14):

- [ ] **Podmíněné a seskupené parametry** ([[03-dokument#Schéma featury]]): `ParamSpec` společně `group?` a `visibleWhen?`; validace skrytý parametr nevyžaduje a nekontroluje; `FieldState.hidden` a dialog pole nekreslí; `referencesOf` skryté parametry přeskočí. → Ú1, Ú6, Ú10 (R70). Test se schématem ve stylu Extrude (`operation`, `endType`, `distance` jen pro `blind`, `upTo` jen pro `upToFace`) je v Ú1. **Upraveno:** obecné `single: true` u referenčních druhů nevzniká, druh `axis` je jednotlivá reference sám o sobě (R71 ⚠); druh `direction` nevzniká – směr vysunutí je normála skici a `flip` (R69 ⚠).
- [ ] **Úniková cesta pro vlastní formulář** ([[11-ui]]): registr v `ui` `featureType → komponenta dialogu`, výchozí generovaný formulář, dokumentace. → Ú10 (R80).

## Mimo rozsah M13

- Konec „Po plochu“ (`upToFace`), „Po další“, dva směry, úkos – potřebují reference na plochy ([[M14-topologicke-pojmenovani|M14]]), R68 ⚠.
- Role ploch (`face:start`, `face:end`, `face:side:<entita>`) z jádra – přesunuto do [[M14-topologicke-pojmenovani#Úkoly z M13|M14]] (R64 ⚠).
- Automatický výběr cílových těles („sloučit se vším, čeho se dotkne“) – R66 ⚠.
- Interaktivní tvorba kvádru tažením (přesunuto z [[M09-interakce]]) – vypuštěno, nápad v [[M15-export-a-dokonceni#Další nápady (mimo rozsah)|M15]] (R79 ⚠).
- Čipy oblastí v poli `regions` (R77 ⚠), výběr oblasti mimo dialog (oblast není položka `SelectionModel`).

## Implementační plán

Každý úkol dělá zvlášť subagent `implementer` (TDD: test nejdřív a ověřit, že padá; `npm run check`). Kontrakty jsou propsané do specifikací (odkazy u úkolů). Implementátor hlásí odchylky, hlavní sezení je propíše. Seznam souborů je vodítko: sáhnout jinam smí, když to dává smysl, a ohlásí to.

**Paralelní běh:** úkoly jedné vlny mají oddělené soubory a běží souběžně ve vlastních worktree. `index.ts` a `testing.ts` modulu, `src/kernel/kernel.ts`, `src/kernel/fake-kernel.ts`, `src/kernel-occt/occt-kernel-impl.ts`, `src/regen/builder.ts`, `.dependency-cruiser.cjs`, `tsconfig*.json`, `src/ui/i18n/{cs,en}.ts`, `src/app/session.ts`, `src/app/testing.ts` a `src/app/plugins.ts` smí v dané vlně měnit jen úkol, u kterého jsou uvedené.

**Nové závislosti npm:** žádné. `BRepPrimAPI_MakePrism` a `BRepPrimAPI_MakeRevol` jsou v předpřipraveném buildu (ověřeno v `replicad_single.d.ts`, R1). Tabulka modulů v `.dependency-cruiser.cjs` a ve [[01-architektura|spec 01]] se nemění (`features/*` z modulu `sketch` nic nepotřebují, `interaction` ho smí od M12).

| Vlna | Úkoly (paralelně) | Závisí na |
|---|---|---|
| A | Ú1 `document` · Ú2 `SweepOps` · Ú3 porty `interaction` | M12 |
| B | Ú4 `regen` · Ú5 `render` oblasti · Ú6 dialog a picking `interaction` | Ú4 na Ú1, Ú2; Ú5 na Ú3; Ú6 na Ú1, Ú3 |
| C | Ú7 Prohlížeč · Ú8 plugin Vysunutí · Ú9 plugin Rotace | Ú7 na Ú6; Ú8 a Ú9 na Ú4 |
| D | Ú10 `app` + `ui` · Ú11 integrační testy | Ú10 na Ú5, Ú7, Ú8, Ú9; Ú11 na Ú8, Ú9 |
| E | Ú12 e2e | D |
| F | Ú13 hlavní sezení | E |

Proč Ú3 (porty) zvlášť a hned ve vlně A: nový druh pickingu a tvar `SketchDrawing` potřebují `render` (Ú5) i `interaction` (Ú6) zároveň; port je malý a s ním můžou oba běžet paralelně, stejně jako M12 Ú5.

Proč `applyBodyOperation` v `regen` a ne v pluginu: pravidla identity „nové / přidat / odebrat / průnik“ jsou stejná pro Vysunutí, Rotaci a později Sweep a Loft a patří k pravidlům identity ve [[07-regenerace#Builder featury|spec 07]] ([[0015-artefakty-a-identita-telesa|ADR 0015]]); pluginy se navzájem importovat nesmí.

### Vlna A

#### Ú1 `document`: podmíněné parametry, druh `axis`, osy počátku
- **Soubory:** `src/document/schema.ts`, `validate.ts`, `references.ts`, `refs.ts`, `origin.ts`, `index.ts` + testy (`schema.test.ts`, `validate.test.ts`, `references.test.ts`, `refs.test.ts`, `origin.test.ts`, `index.test.ts`); `src/ui/components/params/registry.ts` + `registry.test.ts` (jen vynechat `axis`, komponentu dodá Ú10).
- **Kontrakt** ([[03-dokument#Schéma featury]], [[03-dokument#Podmíněné a seskupené parametry (M13)]], [[03-dokument#Reference na jiné entity]], [[03-dokument#Počáteční geometrie (M12)]]):
  ```ts
  // společné pole všech variant ParamSpec
  readonly group?: string;                                                        // klíč překladu nadpisu sekce
  readonly visibleWhen?: (params: Readonly<Record<string, unknown>>) => boolean;  // čistý predikát nad neověřenými params
  | { kind: 'axis'; label: string; group?; visibleWhen? }                          // AxisRef | SketchEntityRef | null
  export function isParamVisible(spec: ParamSpec, params: Readonly<Record<string, unknown>>): boolean;
  export type AxisId = Brand<string, 'AxisId'>;                                    // '<vlastník>/axis:<[a-z0-9]+>'
  export interface AxisRef { readonly kind: 'axis'; readonly axis: AxisId }
  export interface SketchEntityRef { readonly kind: 'sketchEntity'; readonly sketch: FeatureId; readonly entity: string }
  export type EntityRef = BodyRef | TopoRef | SketchRegionRef | PlaneRef | AxisRef | SketchEntityRef;
  export function parseAxisId(v: unknown): AxisId | undefined;
  export function parseSketchId(v: unknown): SketchId | undefined;                 // '<vlastník>/sketch'
  export function ownerOfArtifact(id: BodyId | SketchId | PlaneId | AxisId): FeatureId;
  export const ORIGIN_AXIS_IDS: { readonly x: AxisId; readonly y: AxisId; readonly z: AxisId };
  export interface OriginAxis { readonly id: AxisId; readonly label: string; readonly origin: Vec3; readonly direction: Vec3 }
  export const ORIGIN_AXES: readonly OriginAxis[];                                 // x, y, z; label 'origin.axis.x' …
  ```
  - `validateAgainstSchema`: parametr s `isParamVisible === false` se nekontroluje vůbec (ani `param.missing`); přítomný skrytý parametr není `param.unexpected`. `visibleWhen` se volá jen s objektem `params`.
  - `axis`: `null` → `param.tooFewRefs` `{ min: 1 }`; platná `AxisRef` nebo `SketchEntityRef` (přes `readRef`) projde; cokoli jiného → `param.invalidRef` bez `params`.
  - `readRef`: `axis` přes `parseAxisId`; `sketchEntity` – `sketch` a `entity` neprázdné řetězce. `refKey` (duplicity) pro nové druhy úplný (druh `axis` duplicity mít nemůže, switch musí být vyčerpávající).
  - `referencesOf` skryté parametry přeskočí; druh `axis` dá 0 nebo 1 referenci; interní `refKindOf` → `refKindsOf(spec): readonly EntityRef['kind'][]` (`axis` → `['axis', 'sketchEntity']`).
  - `ownerOf`: `axis` → `ownerOfArtifact(ref.axis)`, `sketchEntity` → `ref.sketch`. `ownerOfArtifact` = text před prvním `/` (chybí → výjimka, chyba programu). `dependenciesOf` reference na `ORIGIN` přeskočí jako u rovin.
  - `ORIGIN_AXES`: `origin [0, 0, 0]`, směry `+X`, `+Y`, `+Z`, hluboce zmrazené.
  - `ui` registr: `ParamFieldKind` vynechá i `axis`, `paramFieldFor('axis')` → `undefined` (Ú10 doplní).
- **Testy:** `isParamVisible` (bez predikátu, true, false); `validateAgainstSchema` se schématem ve stylu Extrude (`operation` enum, `targets` bodies `min: 1` s `visibleWhen: p => p.operation !== 'new'`, `endType`, `distance` s `visibleWhen` pro `blind`, `upTo` topo s `visibleWhen` pro `upToFace`): `operation 'new'` a prázdné `targets` projde, `'add'` a prázdné → `tooFewRefs`, chybějící skrytý parametr projde, chybějící viditelný → `param.missing`, neplatná hodnota skrytého parametru projde; `axis` (null, origin osa, entita skici, neplatná položka, pole místo objektu); `referencesOf` (skrytý `targets` nic nedá, `axis` jedna reference, null nic); `dependenciesOf` – revolve s úsečkou skici závisí na skice, s osou počátku na ničem; `parseAxisId`, `parseSketchId` (platné, bez vlastníka, `/` ve vlastníku, prázdné jméno, velká písmena, ne-řetězec); `ownerOfArtifact`; `ORIGIN_AXES` (id, pořadí, jednotkové směry, zmrazené).
- **Hotovo když:** testy a `npm run check` projdou; `document` exportuje vše z kontraktu.

#### Ú2 `kernel`, `kernel-occt`, `regen`: `SweepOps`
- **Soubory:** `src/kernel/kernel.ts`, `index.ts`, `fake-kernel.ts`, `testing.ts` (kontraktová sada M13) + testy `fake-kernel.test.ts`, `index.test.ts`; `src/kernel-occt/occt-kernel-impl.ts`, `client.ts`, `protocol.ts` (je-li tam výčet metod), `worker-impl.ts`, `index.ts`, `testing.ts` (`createInThreadOcctKernel`) + testy (`occt-sweep.test.ts` nový pro OCCT-specifické případy, kontraktová sada OCCT); `src/regen/builder.ts` (`ModelingKernel` += `SweepOps`), `src/regen/tracking-kernel.ts` + test; testy, které sestavují `ModelingKernel` ručně (např. `aRecordingKernel` v `src/features/boolean/boolean.test.ts`, test builderu skici) – doplnit delegaci `extrude`/`revolve` (ohlásit).
- **Kontrakt** ([[06-geometricke-jadro#Stav po M13]], [[06-geometricke-jadro#Kontrakt (platí pro každou implementaci)]], [[06-geometricke-jadro#Tažení v adaptéru (M13)]], [[06-geometricke-jadro#`FakeKernel`]]):
  ```ts
  export interface Axis { readonly origin: Vec3; readonly direction: Vec3 }   // direction nemusí být jednotková
  export interface SweepOps {
    extrude(profile: ShapeHandle, direction: Vec3, distance: number): Promise<ShapeResult>;
    revolve(profile: ShapeHandle, axis: Axis, angle: number): Promise<ShapeResult>;
  }
  export interface GeometryKernel extends PrimitiveOps, TransformOps, BooleanOps, SketchOps, SweepOps, MeshOps, QueryOps, LifecycleOps {}
  // regen
  export type ModelingKernel = PrimitiveOps & TransformOps & BooleanOps & SketchOps & SweepOps & QueryOps;
  // kernel-occt/testing.ts (jen testy, i tests/)
  export function createInThreadOcctKernel(): Promise<GeometryKernel>;   // loadOcct() + OcctKernelImpl v Node, bez workeru
  ```
  - Validace a výsledek podle odrážek `extrude` a `revolve` v kontraktu spec 06; profil musí být plocha (výsledek `makeFace` nebo jeho `transform`), jinak `'invalid-input'`. Vstupy se čtou synchronně, vstupní handle zůstává platný, každé volání nový handle.
  - Fake: záznam si pamatuje, že je plocha (`makeFace` ano, `transform` dědí, ostatní ne); bbox podle spec 06; `failNext`/`callCount` pro obě metody.
  - OCCT podle „Tažení v adaptéru“: `BRepPrimAPI_MakePrism` / `BRepPrimAPI_MakeRevol`, kontrola typu `TopAbs_FACE`, `IsDone()`, solid ve výsledku a `BRepCheck_Analyzer` → jinak `'operation-failed'`; `using` u všech objektů OCCT. `roles` ani `history` se nevyplňují (R64).
  - `tracking-kernel`: `extrude` a `revolve` přes `track`.
- **Testy:** kontraktová sada M13 a OCCT navíc podle [[06-geometricke-jadro#Testy]]; `regen`: sledované jádro zapíše handle z `extrude` a `revolve`, chybu propustí.
- **Hotovo když:** testy a `npm run check` projdou; `kernel` exportuje `SweepOps`, `Axis`; `createOcctKernel` přeposílá obě metody přes worker.

#### Ú3 `interaction` (+ `render`, `app`): porty pro oblasti skici a Q069
- **Soubory:** `src/interaction/viewport-port.ts`, `tools.ts`, `tool-manager.ts` (typ `ctx`), `regen-status-port.ts`, `select-tool.ts` (ignoruje `sketchRegion`), `testing.ts` (`FakeRegenStatus.publish` se `sketches` s `regions`), `index.ts` + testy; `src/render/viewport.ts`, `picker.ts`, `highlight-layer.ts` (nebo kde se rozlišuje `HighlightTarget`) – jen zástupné ošetření nové varianty + testy; `src/app/regen-status-adapter.ts` (+ test: `regions` z klíčů `SketchArtifact.regions`), `src/app/testing.ts` (je-li potřeba kvůli typům).
- **Kontrakt** ([[10-interakce#Port viewportu]], [[10-interakce#Port stavu regenerace]], [[10-interakce#Nástroje]], [[Q069 Smí nástroj otevřít vlastní transakci|Q069]]):
  ```ts
  export type PickKind = 'face' | 'edge' | 'sketchEntity' | 'sketchRegion';
  // HighlightTarget += { kind: 'sketchRegion'; sketch: string; region: string }       sketch = id kresby, region = jméno oblasti
  // PickResult      += { kind: 'sketchRegion'; sketch: string; region: string; point: Vec3 }
  export interface SketchDrawingRegion { readonly id: string; readonly outer: readonly Vec2[]; readonly holes: readonly (readonly Vec2[])[] }
  // SketchDrawing   += readonly regions?: readonly SketchDrawingRegion[]               uzavřené polygony v rovině kresby
  // RegenSketch     += readonly regions: readonly string[]                             jména oblastí v pořadí artefaktu
  // ToolContext.ops: Pick<OperationDispatcher, 'dispatch' | 'inTransaction'>           Q069
  ```
  - `render` v tomto úkolu oblasti nekreslí ani nepickuje: filtr jen se `sketchRegion` → `null`, zvýraznění varianta `sketchRegion` ignoruje (komentář „Ú5“); jen musí projít typy a testy.
  - `FakeViewport.pick` vrátí připravený výsledek `sketchRegion` jen se `'sketchRegion'` ve filtru (stávající pravidlo pro druhy).
  - `app` adaptér plní `RegenSketch.regions = [...artifact.regions.keys()]`.
- **Testy:** `FakeViewport` s `sketchRegion`; `SelectTool` výsledek `sketchRegion` nikdy nežádá (výchozí filtr) – typově ošetřeno; `FakeRegenStatus` publikuje `regions`; adaptér v `app` publikuje jména oblastí; `ToolManager` dál funguje s dispečerem předaným jako `Pick` (typová kontrola: `begin` na `ctx.ops` neprojde – stačí komentář v testu s `@ts-expect-error`).
- **Hotovo když:** testy a `npm run check` projdou; e2e M10–M12 beze změny.

### Vlna B

#### Ú4 `regen`: osy, reference na oblast a osu, operace tělesa
- **Soubory:** `src/regen/state.ts`, `build-context.ts`, `builder.ts` (`BuildContext`, `RefError`), `body-operation.ts` (nový), `index.ts`, `testing.ts` (`aBuildContext` s novými metodami) + testy `state.test.ts`, `build-context.test.ts`, `body-operation.test.ts`, `regenerator-sweep.test.ts` (osy bez handle), `index.test.ts`; testy jinde, které počítají artefakty `EMPTY_STATE` (ohlásit).
- **Kontrakt** ([[07-regenerace#Princip]], [[07-regenerace#Builder featury]], [[07-regenerace#Operace tělesa (M13)]]):
  ```ts
  export interface AxisArtifact { readonly kind: 'axis'; readonly id: AxisId; readonly owner: FeatureId; readonly origin: Vec3; readonly direction: Vec3 }
  export type ArtifactId = BodyId | SketchId | PlaneId | AxisId;
  export type Artifact = Body | SketchArtifact | PlaneArtifact | AxisArtifact;
  export const EMPTY_STATE: RegenState;            // roviny xy, xz, yz, pak osy x, y, z (ORIGIN_AXES)
  export function axesOf(state: RegenState): readonly AxisArtifact[];
  // BuildContext +=
  resolveRegions(refs: readonly SketchRegionRef[]): Result<ResolvedRegion[], RefError>;
  resolveAxis(ref: AxisRef | SketchEntityRef): Result<ResolvedAxis, RefError>;
  export interface ResolvedRegion { readonly ref: SketchRegionRef; readonly sketch: SketchArtifact; readonly face: ShapeHandle }
  export interface ResolvedAxis { readonly origin: Vec3; readonly direction: Vec3 }   // direction jednotková
  export interface RefError { readonly ref: BodyRef | PlaneRef | SketchRegionRef | AxisRef | SketchEntityRef; readonly message: string }
  export type BodyOperation = 'new' | 'add' | 'remove' | 'intersect';
  export function applyBodyOperation(p: {
    readonly kernel: ModelingKernel; readonly state: RegenState; readonly feature: FeatureId;
    readonly op: BodyOperation; readonly shapes: readonly ShapeHandle[]; readonly targets: readonly Body[];
  }): Promise<RegenState>;
  ```
  - `resolveRegions`: artefakt `sketchId(ref.sketch)` druhu `sketch`, jinak err `Sketch '<f>' not found`; jméno v `regions`, jinak err `Region '<name>' of sketch '<f>' not found`; první nevyřešená reference.
  - `resolveAxis`: `AxisRef` → artefakt druhu `axis`; `SketchEntityRef` → artefakt skici, entita `line` (i konstrukční), body `p1`, `p2` přes `plane.toWorld` z `core`, `direction` normalizovaný; chybějící skica, entita, jiný druh než `line` (`Sketch entity '<id>' is not a line`) nebo nulová délka → err.
  - `applyBodyOperation` přesně podle [[07-regenerace#Operace tělesa (M13)]]: `shapes` prázdné nebo `targets` prázdné u jiné operace než `new` → výjimka (chyba programu, schéma má `min: 1`); výsledná tělesa a stav zmrazené; pořadí mapy jako u Booleanu.
- **Testy:** `EMPTY_STATE` (3 roviny a 3 osy v pořadí, rámce, zmrazené); `axesOf`, `bodiesOf` ignoruje osy; `resolveRegions` (oblast, dvě oblasti dvou skic, chybějící skica, chybějící jméno, id tělesa místo skici); `resolveAxis` (osa Z počátku, úsečka skici na rovině XZ → světové souřadnice, konstrukční úsečka, kružnice → err, chybějící entita, chybějící skica, nulová délka); `applyBodyOperation` s `FakeKernel` a záznamem volání: `new` s jedním a se dvěma tvary (jedno `union`), `add` se dvěma cíli (identita prvního, druhý zmizí, pořadí mapy), `remove` a `intersect` po cílech zvlášť (identita každého cíle, `lastModifiedBy`), chyba jádra proletí; sweep s osami (osy handle nemají).
- **Hotovo když:** testy a `npm run check` projdou; `regen` exportuje nové typy a funkce.

#### Ú5 `render`: výplň a picking oblastí
- **Soubory:** `src/render/sketch-pick.ts` (čisté: `pickSketchRegion`, `pointInRegion`) + test, `sketch-layer.ts` (výplně oblastí, `setRegionHighlight`), `viewport.ts` (nahradí zástupné ošetření z Ú3), `highlight-layer.ts` (předá cíle `sketchRegion` vrstvě skic), `palette.ts` (+ test, je-li nová barva); `dev/viewport.html` (ruční ukázka, je-li jednoduché).
- **Kontrakt** ([[09-vykreslovani#Skici]], [[09-vykreslovani#Picking]]):
  ```ts
  /** Nejbližší oblast pod paprskem; null = žádná. Kresby bez regions se přeskočí. */
  export function pickSketchRegion(drawings: ReadonlyMap<string, SketchDrawing>, ray: { origin: Vec3; direction: Vec3 }):
    { readonly sketch: string; readonly region: string; readonly point: Vec3 } | null;
  export function pointInRegion(p: Vec2, region: SketchDrawingRegion): boolean;   // sudo-liché pravidlo přes outer i holes
  ```
  - Průsečík paprsku s rovinou kresby (`plane.intersectRay`, `toLocal`), bod v polygonu; z více kreseb nejbližší podél paprsku. Zakrytí tělesy se nekontroluje (jako R47).
  - `pick` s filtrem: `sketchEntity` > `sketchRegion` > `edge` > `face`.
  - Výplň: `ShapeGeometry` z `THREE.Shape` s dírami v souřadnicích roviny, transformovaná rámcem roviny; bez zvýraznění neviditelná; hover barvou `hover`, výběr barvou `selection`, průhlednost 0,35, `depthTest: false`, `renderOrder` 2 (pod čarami skici). `set`/`remove` kresby výplně přestaví, `dispose` uvolní geometrie a materiály.
- **Testy:** `pointInRegion` (uvnitř, v díře, venku, na konkávním polygonu); `pickSketchRegion` (zásah, díra → `null`, mimo, rovnoběžný paprsek → `null`, nejbližší ze dvou kreseb nad sebou, kresba na rovině XZ, kresba bez `regions`). Three.js část ručně na dev stránce (ohlásit, co bylo ověřeno).
- **Hotovo když:** testy a `npm run check` projdou; `npm run build` projde.

#### Ú6 `interaction`: dialog, picking do parametru, kresba
- **Soubory:** `src/interaction/feature-editor.ts`, `ref-pick-tool.ts`, `ref-values.ts`, `tool-manager.ts` (`createRefPick` dostane `doc`), `sketch-drawing.ts`, `selection.ts` (`bindSelectionHighlight`), `index.ts` + testy `feature-editor.test.ts`, `ref-pick-tool.test.ts`, `ref-values.test.ts`, `sketch-drawing.test.ts`, `selection.test.ts`, `index.test.ts`.
- **Kontrakt** ([[10-interakce#Dialog featury: `FeatureEditor`]], [[10-interakce#Nástroje]], [[10-interakce#Kresba skici]], [[10-interakce#Výběr]]):
  ```ts
  // FieldState +=
  readonly hidden: boolean;                 // !isParamVisible(spec, params)
  readonly group: string | null;            // spec.group
  readonly refText: RefText | null;         // jen druh 'axis' s hodnotou; jinak null
  export interface RefText { readonly key: string; readonly params: Readonly<Record<string, string>> }
  // pickFilterFor: region → ['sketchRegion'], axis → ['sketchEntity']
  export function axisDrawing(axis: { readonly origin: Vec3; readonly direction: Vec3 }, size?: number): SketchDrawing;
  export function bindSelectionHighlight(selection: SelectionModel, highlight: HighlightPort,
    editor?: Pick<FeatureEditor, 'current'>): Unsubscribe;
  ```
  - `FeatureEditor`: referenční druhy = `bodies`, `topo`, `region`, `planes` (jen `focusRefParam`), `axis`; `activeRefParam` jen viditelný parametr – když ho změna parametrů skryje, nastaví se `null`; `focusRefParam` skrytého parametru → výjimka; `create` aktivuje první **viditelný** referenční parametr druhu `bodies`/`topo`/`region`/`axis`. `refText`: origin osa → `{ key: <label z ORIGIN_AXES>, params: {} }`; jiná `AxisRef` nebo entita skici, jejíž featura chybí → `{ key: 'field.missingRef', params: {} }`; entita skici → `{ key: 'field.sketchLine', params: { sketch: <jméno featury> } }`. Nezměněné `FieldState` zůstává týž objekt (porovnání i nových polí).
  - `ref-values`: `toggleRegionRef(value, sketch: FeatureId, region: string)` (jako `toggleBodyRef`), `toggleAxisRef(value, ref)` (stejná reference → `null`, jinak `ref`), `isSketchLine(doc, sketch, entity)` (entita v `parseSketchData` dat featury skici je `line`).
  - `refPick`: region – zásah `sketchRegion`, jehož kresba je id skici (`parseSketchId`, ne `'sketch-edit'`) → `toggleRegionRef(…, ownerOfArtifact(id), region)`; osa – zásah `sketchEntity`: kresba je `AxisId` (`parseAxisId`) → `AxisRef`; kresba je id skici a entita je úsečka (`isSketchLine`) → `SketchEntityRef`; jinak nic. Hover u osy jen pro zásahy, které by šly převést (jinak `setHover(null)`).
  - `artifactDrawing(plane, entities)`: nekonstrukční křivky stylem `normal`, **konstrukční** stylem `construction` (R74), bez bodů, a `regions` z `computeRegions({ entities, constraints: [] })` – jméno oblasti jako `id`, oblouky a kružnice lomenou čarou s krokem π/36 (`outer` proti směru hodin, díry jak přijdou).
  - `axisDrawing`: rovina s `xDir = d̂`, `normal = unit(d̂ × (|d̂_z| < 0.9 ? +Z : +X))` a počátkem `axis.origin`; jedna úsečka id `'axis'` od `−size/2` do `size/2` (výchozí 100) stylem `plane`; bez bodů a oblastí.
  - `bindSelectionHighlight` s `editor`: cíle = položky `face`/`edge` výběru a pro otevřenou session reference **viditelných** parametrů druhu `region` jako `{ kind: 'sketchRegion', sketch: sketchId(ref.sketch), region }`; sleduje `editor.current` i `state` session; bez `editor` jako dosud.
- **Testy:** `FieldState.hidden` a `group` podle predikátu (testovací schéma ve stylu Extrude; změna `operation` skryje `targets` a zruší jeho fokus); `focusRefParam` skrytého → výjimka; `create` aktivuje první viditelný referenční parametr; `refText` (origin osa, úsečka skici, chybějící skica, `null`); `pickFilterFor` (`region`, `axis`); `refPick` (klik na oblast přidá a podruhé odebere `SketchRegionRef`, oblast z `'sketch-edit'` nic, klik na osu počátku nastaví `AxisRef`, na úsečku skici `SketchEntityRef`, na kružnici nic a hover `null`, druhý klik na tutéž osu → `null`); `artifactDrawing` (konstrukční úsečka stylem `construction`, oblasti obdélníku a obdélníku s kružnicí – díra, počet bodů kruhu); `axisDrawing` pro osy X, Y, Z a šikmou (úsečka leží na ose); `bindSelectionHighlight` s dialogem s oblastmi (cíle, změna hodnoty, skrytý parametr, zavření session).
- **Hotovo když:** testy a `npm run check` projdou; e2e M10–M12 beze změny.

### Vlna C

#### Ú7 `interaction`: Prohlížeč – osy a oblasti
- **Soubory:** `src/interaction/browser-model.ts`, `index.ts` + testy `browser-model.test.ts`, `index.test.ts`.
- **Kontrakt** ([[10-interakce#Prohlížeč: `BrowserModel` a viditelnost těles]]):
  ```ts
  // BrowserModel +=
  readonly axes: Observable<readonly BrowserAxisRow[]>;          // ORIGIN_AXES v pořadí
  readonly visibleAxes: Observable<ReadonlySet<AxisId>>;         // stav pohledu, výchozí prázdné
  setAxisVisible(axis: AxisId, visible: boolean): void;
  selectAxis(axis: AxisId): void;                                // aktivní parametr 'axis' → setParam(name, toggleAxisRef(…)); jinak nic
  selectRegion(feature: FeatureId, region: string): void;        // aktivní parametr 'region' → setParam(name, toggleRegionRef(…)); jinak nic
  export interface BrowserAxisRow { readonly axis: AxisId; readonly label: string; readonly visible: boolean; readonly active: boolean }   // active = hodnota aktivního parametru 'axis'
  // BrowserSketchRow += readonly regions: readonly BrowserRegionRow[]   // jen při aktivním parametru 'region', jinak [] (sdílené zmrazené pole)
  export interface BrowserRegionRow { readonly region: string; readonly n: number; readonly selected: boolean }   // n od 1 v pořadí RegenSketch.regions; selected = v hodnotě aktivního parametru
  ```
  - Model se přepočítá i při změně `editor.current` a `state` otevřené session (aktivní parametr a jeho hodnota). Pořadí vyslání: `hidden`, `visiblePlanes`, `visibleAxes`, `bodies`, `planes`, `axes`, `sketches`. Nezměněný řádek týž objekt.
  - `deps.editor` se rozšíří na `Pick<FeatureEditor, 'current'>` beze změny (session má `state` a `setParam`).
- **Testy:** osy (3 řádky, viditelnost jen ve `visibleAxes`, `selectAxis` bez dialogu nic, s aktivním parametrem `axis` nastaví a podruhé zruší, `active`); oblasti (bez dialogu `[]`, s aktivním `region` řádky v pořadí s `n`, `selectRegion` přidá a odebere, `selected`, skica bez oblastí `[]`, aktivní parametr jiného druhu `[]`); nový snapshot jen při změně.
- **Hotovo když:** testy a `npm run check` projdou.

#### Ú8 `features/extrude`: plugin Vysunutí
- **Soubory:** `src/features/extrude/*` (nová složka: `index.ts`, `schema.ts`, `builder.ts`, `tool.ts`, `messages.ts`, `extrude.test.ts`). Do `app/plugins.ts` **nezapisuje** (Ú10).
- **Kontrakt** ([[07-regenerace#Operace tělesa (M13)]], [[06-geometricke-jadro#Stav po M13]]):
  ```ts
  export interface ExtrudeParams {
    readonly regions: readonly SketchRegionRef[];                   // region, min 1
    readonly operation: 'new' | 'add' | 'remove' | 'intersect';     // enum, výchozí 'new'
    readonly targets: readonly BodyRef[];                           // bodies, min 1, group 'extrude.group.merge', visibleWhen operation !== 'new'
    readonly endType: 'blind' | 'symmetric';                        // enum, výchozí 'blind'
    readonly distance: number;                                      // length, výchozí 10, > 0
    readonly flip: boolean;                                         // boolean, výchozí false, visibleWhen endType !== 'symmetric'
  }
  export const extrudePlugin: FeaturePlugin<ExtrudeParams>;
  ```
  - Schéma `type: 'extrude'`, `version: 1`, `label: 'extrude.label'`, `icon: 'arrow-big-up-lines'`, parametry v pořadí výše, labely `extrude.<param>`, možnosti `extrude.operation.<value>`, `extrude.endType.<value>`; hluboce zmrazené; `validate = validateAgainstSchema`.
  - **Builder:** (1) `resolveRegions(regions)` → chyba `unresolvedReference('regions', e)`; (2) pro operaci ≠ `new` `resolveBodies(targets)` → `unresolvedReference('targets', e)`; skrytý `targets` se nečte; (3) směr `d = normal roviny skici první oblasti`, `flip` (jen `blind`) → `−d`; (4) `blind`: `extrude(face, d, distance)` pro každou oblast v pořadí; `symmetric`: každou plochu nejdřív `transform` o posun `−d · distance/2` (`mat4.translation`), pak `extrude(…, d, distance)`; (5) `applyBodyOperation({ kernel, state, feature: feature.id, op: operation, shapes, targets })`. Chyba jádra proletí (`KERNEL`).
  - **Nástroj:** `id 'extrude'`, `label 'extrude.label'`, `icon 'arrow-big-up-lines'`, `group 'feature'`, `shortcut 'Shift+E'`; jako `booleanTool` (otevře dialog a skončí).
  - **Texty:** cs „Vysunutí“, „Oblasti“, „Operace“, „Nové těleso“, „Přidat“, „Odebrat“, „Průnik“, „Sloučit s“ (`targets`), „Cílová tělesa“ (`extrude.group.merge`), „Konec“, „Do vzdálenosti“, „Symetricky“, „Vzdálenost“, „Opačný směr“; en “Extrude”, “Regions”, “Operation”, “New body”, “Add”, “Remove”, “Intersect”, “Merge with”, “Target bodies”, “End type”, “Blind”, “Symmetric”, “Distance”, “Opposite direction”.
- **Testy:** společné testy pluginu jako `boolean.test.ts` (veřejné API, zmrazení, `registerPlugin`, schéma a výchozí hodnoty, výchozí + vybraná oblast projdou); viditelnost (`targets` jen pro ≠ `new`, `flip` jen pro `blind`) přes `isParamVisible`; builder s `FakeKernel` přes `aBuildContext` a ručně sestavený `SketchArtifact` (plocha z `makeFace`, featury se navzájem importovat nesmí): obdélník 40 × 20 na XY → těleso `bodyId(f)` s bbox `[0, 40] × [0, 20] × [0, 10]`; `flip` → `z ∈ [−10, 0]`; `symmetric` → `z ∈ [−5, 5]` (a `transform` zavolán); skica na XZ → `y ∈ [−10, 0]` (normála −Y); dvě oblasti → jedno těleso, jedno `union`; `add` a `remove` (identita cíle, `lastModifiedBy`, záznam volání `boolean`); `intersect`; neexistující oblast → `UNRESOLVED_REFERENCE` s `param: 'regions'`; neexistující cíl → `param: 'targets'`; `operation 'new'` s neplatným skrytým `targets` projde validací i buildem; `failNext('extrude', …)` → výjimka proletí.
- **Hotovo když:** testy a `npm run check` projdou; mimo `features/extrude` žádná změna.

#### Ú9 `features/revolve`: plugin Rotace
- **Soubory:** `src/features/revolve/*` (nová složka: `index.ts`, `schema.ts`, `builder.ts`, `tool.ts`, `messages.ts`, `revolve.test.ts`). Do `app/plugins.ts` **nezapisuje** (Ú10).
- **Kontrakt:**
  ```ts
  export interface RevolveParams {
    readonly regions: readonly SketchRegionRef[];                   // region, min 1
    readonly axis: AxisRef | SketchEntityRef | null;                // axis, výchozí null
    readonly operation: 'new' | 'add' | 'remove' | 'intersect';     // jako Extrude
    readonly targets: readonly BodyRef[];                           // jako Extrude, group 'revolve.group.merge'
    readonly angle: number;                                         // angle, výchozí 2π, > 0, ≤ 2π
    readonly flip: boolean;                                         // visibleWhen angle < 2π − 1e-9
  }
  export const revolvePlugin: FeaturePlugin<RevolveParams>;
  ```
  - Schéma `type: 'revolve'`, `version: 1`, `label: 'revolve.label'`, `icon: 'rotate-360'`; labely `revolve.<param>`, možnosti `revolve.operation.<value>`.
  - **Builder:** `resolveRegions` → `'regions'`; `resolveAxis(axis)` → `unresolvedReference('axis', e)` (`axis` je po validaci nenulová); cíle jako Extrude; `flip` → osa s opačným `direction`; `revolve(face, osa, angle)` pro každou oblast; `applyBodyOperation`.
  - **Nástroj:** `id 'revolve'`, `label 'revolve.label'`, `icon 'rotate-360'`, `group 'feature'`, `shortcut 'Shift+W'`.
  - **Texty:** cs „Rotace“, „Oblasti“, „Osa“, „Operace“ (+ možnosti jako Extrude), „Sloučit s“, „Cílová tělesa“, „Úhel“, „Opačný směr“; en “Revolve”, “Regions”, “Axis”, “Operation”, …, “Merge with”, “Target bodies”, “Angle”, “Opposite direction”.
- **Testy:** společné testy pluginu; výchozí hodnoty validací neprojdou (`regions` a `axis` → `tooFewRefs`, R24), s oblastí a osou projdou; `flip` viditelný jen pro úhel < 360°; builder s `FakeKernel`: obdélník na XZ (`x ∈ [5, 10]`, `z ∈ [0, 10]`) kolem `origin/axis:z` o 2π → bbox `[−10, 10]² × [0, 10]`; o π/2 → `[0, 10]² × [0, 10]`; s `flip` o π/2 → `x ∈ [0, 10]`, `y ∈ [−10, 0]`; osa z konstrukční úsečky skici; kružnice jako osa → `UNRESOLVED_REFERENCE` s `param: 'axis'`; chybějící skica osy; `remove` z tělesa.
- **Hotovo když:** testy a `npm run check` projdou; mimo `features/revolve` žádná změna.

### Vlna D

#### Ú10 `app`, `ui`: registrace, pole osy, dialog, Prohlížeč, lišta, překlady
- **Soubory:** `src/app/plugins.ts` (`extrudePlugin`, `revolvePlugin` na konec `BUILT_IN_PLUGINS`), `session.ts` (`bindSelectionHighlight(…, features)`, kresby os z `browser.visibleAxes` přes `axisDrawing` pod id osy), `testing.ts` (je-li potřeba) + testy `session.test.ts`, `plugins.test.ts`; `src/ui/toolbar-groups.ts` (+ test), `src/ui/components/params/AxisField.vue` (nový), `params/registry.ts` (+ test: `region` → `RefListField`, `axis` → `AxisField`, vynechává jen `data`), `FeatureDialog.vue` (skrytá pole a nadpisy skupin), `feature-dialogs.ts` (nový: úniková cesta) + test, `AppShell.vue` (dialog přes `dialogFor`), `Browser.vue` (osy, oblasti), `src/ui/i18n/cs.ts`, `en.ts` (+ test úplnosti, je-li).
- **Kontrakt** ([[11-ui#Komponenty]], [[11-ui#Kompoziční kořen (app)]], [[11-ui#Vlastní dialog featury (úniková cesta)]]):
  ```ts
  // ui/components/feature-dialogs.ts
  export const FEATURE_DIALOGS: Readonly<Record<string, Component>>;   // featureType → komponenta; v M13 prázdné
  export function dialogFor(featureType: string): Component;           // FEATURE_DIALOGS[type] ?? FeatureDialog
  ```
  - Vlastní komponenta dialogu má stejné rozhraní jako `FeatureDialog` (prop `edit: FeatureEditSession`, nic dalšího) a stejná pravidla (logika v `interaction`, ne ve `.vue`). Dokumentace v [[11-ui#Vlastní dialog featury (úniková cesta)]].
  - `FeatureDialog`: pole s `field.hidden` nekreslí; před prvním viditelným polem skupiny (jiná `group` než u předchozího viditelného pole, `null` = bez nadpisu) nadpis `t(group)` (`role="heading"`, `aria-level` 3).
  - `AxisField`: tlačítko aktivního stavu jako `RefListField` (vysílá `activate`), text `t(field.refText.key, field.refText.params)`, bez hodnoty „Nevybráno“ (`field.noRef`), × (`aria-label` „Odebrat {name}“) vyšle `update(null)`; přístupný název z popisku pole.
  - `RefListField` u druhu `region` jen počet (bez čipů, R77).
  - `toolbarGroups`: pořadí skupin `history`, `sketch`, `feature`, `primitive`, `modify`, `construction`, `view`, `select` (`feature` za `sketch`, popisek `toolbar.group.feature` už existuje).
  - `Browser`: ve skupině Počátek pod rovinami tři osy (oko = `setAxisVisible`, klik = `selectAxis`, `aria-pressed` podle `active`); u skici pod řádkem řádky oblastí z `row.regions` („Oblast {n}“, klik = `selectRegion`, `aria-pressed` podle `selected`).
  - **Překlady** (cs / en; klíče pluginů dodávají pluginy): `origin.axis.x` „Osa X“ / “X axis”, `.y`, `.z` obdobně; `browser.region` „Oblast {n}“ / “Region {n}”; `field.noRef` „Nevybráno“ / “Not selected”; `field.missingRef` „Chybí položka“ / “Missing reference”; `field.sketchLine` „Úsečka ze skici {sketch}“ / “Line of {sketch}”; **změna** `param.unresolvedRef` na „Odkazovaná položka neexistuje“ / “The referenced item does not exist” (R82).
- **Testy:** `session.test.ts` s `FakeViewport`, `FakeSolver`, `FakeKernel`: zapnutí osy v Prohlížeči → kresba `axisDrawing` pod id osy, vypnutí → `remove`; po regeneraci se skicou má kresba skici `regions`; otevřený dialog vysunutí s vybranou oblastí → `highlight.setSelection` obsahuje `sketchRegion`; `plugins.test.ts` – sedm pluginů, session se otevře bez kolize klíčů; `toolbarGroups` se skupinou `feature`; registr polí; `dialogFor` (neznámý typ → `FeatureDialog`, typ z registru → jeho komponenta přes testovací registr nebo injektovaný záznam).
- **Hotovo když:** testy, `npm run check` a `npm run build` projdou; e2e M10–M12 beze změny.

#### Ú11 `tests`: integrační scénáře
- **Soubory:** `tests/extrude-scenario.test.ts` (nový), případně `tests/revolve-scenario.test.ts`.
- **Kontrakt:** propojení jako `tests/boolean-scenario.test.ts` a `tests/sketch-scenario.test.ts` (dokument, dispečer, log, `UndoManager`, `Regenerator`, `FeatureEditor`, pluginy přes `registerPlugin`: box, sketch, extrude, revolve).
- **Testy:**
  1. **Změna kóty** (`FakeKernel`, `createSketchEditor` s `createInThreadPlanegcsSolver()`): skica obdélníku 40 × 20 s `fix` a dvěma kótami, „Hotovo“; `features.create('extrude')`, `setParam('regions', [{ kind: 'region', sketch, region }])` (jméno oblasti z `SketchArtifact.regions`), `commit` → log o jeden záznam delší, jedno těleso `bodyId(extrude)` s bbox `[0, 40] × [0, 20] × [0, 10]`; úprava skici (`setDimension` šířky na 60, `finish`) → totéž `BodyId`, bbox `x ∈ [0, 60]`, extrude bez chyby; undo → bbox zpět 40; `replayLog` do nového dokumentu = stejný `toData`; smazání úsečky obdélníku ve skice → extrude `UNRESOLVED_REFERENCE` s `issues` `param: 'regions'`.
  2. **Díra** (`createInThreadOcctKernel()` z `@/kernel-occt/testing`, data skici přes `FeatureEditSession.setParams` bez řešiče): kvádr `origin [0, 0, 0]`, 10 × 10 × 10; skica na XY s kružnicí střed `[5, 5]`, r = 2; extrude `operation 'remove'`, `targets` [kvádr], `distance 10` → v konečném stavu jediné těleso s `BodyId` kvádru a `lastModifiedBy` = extrude; síť (`tessellate`) má 7 ploch a objem `1000 − 40π` (1 %); `liveHandleCount()` = počet živých handle (těleso + plocha oblasti).
  3. **Rotace** (OCCT): skica na XZ s obdélníkem `x ∈ [5, 10]`, `z ∈ [0, 10]`, revolve kolem `ORIGIN_AXIS_IDS.z` o 2π → 4 plochy, objem `750π` (1 %); kolem konstrukční úsečky skici na ose `x = 0` stejný výsledek.
- **Hotovo když:** `npm run test:integration` a `npm run check` projdou.

### Vlna E

#### Ú12 `e2e`: akceptační scénář v prohlížeči
- **Soubory:** `e2e/m13.spec.ts` (nový); pomocné funkce ze `e2e/helpers.ts` (skica obdélníku z M12 smí přesunout do helpers).
- **Scénář** (OCCT a planegcs v prohlížeči, česky, prvky přes role a přístupné názvy):
  1. Nový dokument → skica obdélníku s dvěma kótami jako v `e2e/m12.spec.ts` → „Hotovo“.
  2. „Vysunutí“ → dialog „Vysunutí 1“, pole „Sloučit s“ není vidět; v Prohlížeči u „Skica 1“ řádek „Oblast 1“ → klik → pole „Oblasti“ ukazuje 1; „OK“ → Timeline „Vysunutí 1“ bez chyby, Prohlížeč „Těleso 1“.
  3. Dvojklik na „Skica 1“ → pole „Vzdálenost 1“ na dvojnásobek, Enter → „Hotovo“ → Timeline bez chyby („Chyby:“ není), stále jedno těleso.
  4. „Kvádr“ → „OK“; nová skica s kružnicí (nástroj „Kružnice“, dva kliky) → „Hotovo“; „Vysunutí“ → oblast kružnice v Prohlížeči; „Operace“ = „Odebrat“ → pole „Sloučit s“ se objeví; aktivovat ho a klik na těleso kvádru v Prohlížeči → „OK“ → bez chyby, počet těles se nezměnil.
  5. „Zpět“ → „Vysunutí 2“ zmizí; „Znovu“ → zpět; reload po uložení → featury v Timeline, bez chyby.
  6. „Rotace“ → oblast obdélníku z kroku 1 v Prohlížeči, pole „Osa“ aktivovat a v Prohlížeči (skupina Počátek) klik na „Osa X“ (spodní hrana obdélníku na ní leží, profil ji neprotíná, výsledek je platný) → pole ukazuje „Osa X“ → „OK“ → Timeline „Rotace 1“ bez chyby, o jedno těleso víc.
  7. Konzole bez chyb.
- **Hotovo když:** `npm run test:e2e` projde v Chrome i WebKit; `npm run check`, `npm run build` zelené.

### Vlna F

#### Ú13 Hlavní sezení
- Zkontrolovat kód Ú1–Ú12 proti specifikacím, propsat odchylky (03, 06, 07, 09, 10, 11, 12), převést otázky implementátorů na otázky ve vaultu.
- Ověřit, že `features/extrude` a `features/revolve` neimportují `sketch` ani jiný plugin a že `interaction` nezná `regen`.
- `architecture-reviewer`, oprava nálezů, retrospektiva, poznatky (kandidáti: podmíněné parametry jako data vs. logika, operace tělesa jako sdílené pravidlo identity, picking oblasti bez jádra), `/milnik konec M13`, commit.

## Co se naučíš

- Jak se z rovinné plochy stane těleso (`BRepPrimAPI_MakePrism`, `MakeRevol`) a proč je profil handle v jádře, ne data.
- Kde končí „data“ schématu a začíná logika: predikát `visibleWhen` je čistá funkce nad parametry, kterou sdílí validace, závislosti i UI.
- Jak jedno pravidlo identity („nové / přidat / odebrat / průnik“) obslouží víc featur bez dědičnosti – sdílená funkce v `regen`.
- Picking bez jádra: průsečík paprsku s rovinou a bod v polygonu.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení)_
