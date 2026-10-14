---
type: milestone
status: doing
order: 14
aliases:
  - M14
  - M14 Topologické pojmenování
modules:
  - kernel
  - kernel-occt
  - sketch
  - document
  - regen
  - interaction
  - render
  - features
  - app
  - ui
specs:
  - "[[08-topologicke-pojmenovani]]"
  - "[[06-geometricke-jadro]]"
  - "[[07-regenerace]]"
  - "[[03-dokument]]"
  - "[[09-vykreslovani]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
  - "[[12-skicar]]"
depends_on:
  - "[[M13-extrude-revolve]]"
started: 2026-10-14
finished: 
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-14
---
# M14 – Topologické pojmenování, Fillet, Chamfer, skica na ploše

**Cíl:** stabilní reference na plochy a hrany napříč regeneracemi. Na nich fillet, chamfer, skica na ploše tělesa a konec vysunutí „Po plochu“. Nejzajímavější a nejtěžší milník – test celé architektury.

**Specifikace:** [[08-topologicke-pojmenovani|08]] (jména, `NameTable`, `propagateNames`, `resolveTopo`, scénáře), [[06-geometricke-jadro|06]] (`topology`, role, historie, `DressupOps`), [[07-regenerace|07]] (`nameShape` v builderech, `resolveTopo`, `resolvePlanes` s `TopoRef`, Fillet/Chamfer), [[03-dokument|03]] (`planes` s `TopoRef`), [[10-interakce|10]] (`TopoNames` v portu, výběr podle jmen, `refPick` pro `topo`, skica na ploše, `TopoInspector`), [[09-vykreslovani|09]] (zvýraznění tělesa), [[11-ui|11]] (registrace, ladicí panel), [[12-skicar|12]] (rovina na ploše, id křivek v oblastech)

**Rozhodnutí:** [[0007-vlastni-topologicke-pojmenovani|ADR 0007]], [[0018-format-topologickych-jmen|ADR 0018]] (formát jmen), [[Q014 Více hran mezi dvěma plochami|Q014]], [[Q015 Rozdělená plocha a reference|Q015]], R91–R113 v [[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování]] (noční rychloakce, bez Pavla).

**Navazuje na:** [[M13-extrude-revolve]] – plán začíná **po sloučení M13** (`SweepOps`, `applyBodyOperation`, `resolveRegions`, `resolveAxis`, pluginy Vysunutí a Rotace, podmíněné parametry, `createInThreadOcctKernel` v `kernel-occt/testing.ts`).

## Úkoly

- [x] Ú0 hlavní sezení: typy portu jádra a `Curve2.id` (vlna 0)
- [ ] Ú1 `kernel`, `kernel-occt`: `topology`, role, historie u všech operací, `DressupOps.fillet`/`chamfer`
- [ ] Ú2 `regen`: `NameTable`, `propagateNames` (čistá funkce)
- [ ] Ú3 `interaction` (+ zástupné místo v `render`, `app`): `TopoNames` v portu, výběr přežije regeneraci, `HighlightTarget` druhu `body`
- [ ] Ú4 `sketch`: id křivek v oblastech
- [ ] Ú5 `document`: `planes` přijímá `TopoRef`
- [ ] Ú6 `regen`: `nameShape`, `resolveTopo`, `resolvePlanes` s plochou, `sketchPlaneOfFace`, `planeOfRef`, jména v `applyBodyOperation`, `DressupOps` v `ModelingKernel`
- [ ] Ú7 `render`: zvýraznění celého tělesa
- [ ] Ú8 `interaction`: `refPick` pro `topo`, zvýraznění referencí `topo` a `bodies` v dialogu
- [ ] Ú9 `features/box|cylinder|transform|boolean`: pojmenování v builderech
- [ ] Ú10 `features/fillet`, `features/chamfer`: pluginy Zaoblení a Zkosení
- [ ] Ú11 `features/extrude`: konec „Po plochu“
- [ ] Ú12 `interaction`: skica na ploše, `TopoInspector`
- [ ] Ú13 `app`, `ui`: registrace, propojení session, ladicí panel, lišta, překlady
- [ ] Ú14 `tests`: čtyři akceptační scénáře spec 08 s OCCT v Node
- [ ] Ú15 `e2e`: fillet hrany kvádru přežije změnu rozměru
- [ ] Ú16 hlavní sezení: kontrola, vault, `architecture-reviewer`, retrospektiva

## Akceptační kritéria

- **Čtyři scénáře** ze [[08-topologicke-pojmenovani#Scénáře, které musí fungovat (akceptační testy M14)|spec 08]] jako automatické integrační testy s OCCT v Node (Ú14): fillet přežije změnu výšky kvádru; skica na horní ploše a vysunutí přežijí změnu rozměru; fillet na hraně díry přežije posun válce; smazaná reference → čitelná chyba `UNRESOLVED_REFERENCE` u parametru, zbytek modelu v pořádku.
- **E2E:** kvádr → výběr hrany ve viewportu do dialogu „Zaoblení“ → OK → změna výšky kvádru → zaoblení bez chyby (Ú15).
- **Výběr přežije regeneraci:** vybraná hrana zůstane po změně parametru vybraná na „stejné“ hraně (test `SelectionModel`, Ú3).
- `propagateNames` má testy na ručně sestavených historiích pro každé pravidlo spec 08 (Ú2); kontraktová sada ověřuje úplnost historie pro obě jádra (Ú1).
- Celý dialog je v logu jeden záznam; undo/redo a reload vrátí model.
- `npm run check`, `npm run test:integration`, `npm run build`, `npm run test:e2e` zelené.

## Úkoly z revize architektury (doplněno 2026-10-13, [[M10.1-zpevneni-kostry]])

Nález 5 z [[Revize architektury 2026-10-13]], druhá část: jména v portu a přemapování výběru. Zapracováno do Implementačního plánu (2026-10-14):

- [ ] **Jména v portu** ([[10-interakce#Port stavu regenerace]]): artefakt tělesa v `RegenSnapshot` nese `names`; `interaction` převádí pick na `TopoRef` bez znalosti `regen`. → Ú3 (`RegenBody.names: TopoNames`, úzké rozhraní v `interaction`, R102), Ú8, Ú13.
- [ ] **Výběr přežije regeneraci** ([[10-interakce#Výběr]], nahrazuje pravidlo z [[Q064 Výběr po regeneraci|Q064]]). → Ú3. **Upraveno:** jméno doplní `SelectionModel` sám z posledního snapshotu (nástroje nic nemění); jméno na víc ploch → všechny (R102).
- [ ] **`PickResult` a `HighlightTarget`** o `name?`, `PickKind` o `'vertex'`. **Upraveno:** ani jedno nevzniká – `render` jména nepotřebuje a vrcholy nemají spotřebitele (R101 ⚠).

## Úkoly z M11

Odloženo z [[M11-dalsi-entity|M11]] ([[Rozhodnutí noční rychloakce#M11 – Další entity|R8]], R19):

- [ ] **Boolean s více výslednými tělesy** ([[07-regenerace#Builder featury]]). **Znovu odloženo do [[M15-export-a-dokonceni#Úkoly z M14|M15]]** (R100 ⚠): potřebuje nový dotaz jádra (rozklad na solidy s historií), pravidlo číslování `n` z rodokmenu a ošetření kolize id; akceptační scénáře M14 ho nepotřebují.
- [ ] **Zvýraznění těles vybraných v dialogu** ([[10-interakce#Port viewportu]]): `HighlightTarget` druhu `body`. → Ú3 (typ), Ú7 (`render`), Ú8 (reference `bodies` v dialogu a tělesa ve výběru, R104).

## Úkoly z M13

Odloženo z [[M13-extrude-revolve|M13]] ([[Rozhodnutí noční rychloakce#M13 – Extrude a Revolve|R64, R66, R68]]):

- [ ] **Role ploch Vysunutí a Rotace** ([[06-geometricke-jadro#Stav po M14]], [[08-topologicke-pojmenovani#Plochy]]). → Ú0, Ú4 (id křivek), Ú1 (role hran profilu u handle, `face:start|end|side:<entita>`), Ú6 (jména přes historii booleanu v `applyBodyOperation`, R98, R99 ⚠).
- [ ] **Konec „Po plochu“** u Vysunutí. → Ú11 (R109 ⚠: jen rovinná plocha rovnoběžná se skicou).
- [ ] (Volitelné) **Automatické cíle** „sloučit se vším, čeho se dotkne“. **Odloženo do [[M15-export-a-dokonceni#Úkoly z M14|M15]]** (R109 ⚠): potřebuje dotaz jádra na průnik.

## Mimo rozsah M14

- Rozpad výsledku booleanu na víc těles (R8, R100 ⚠), automatické cíle vysunutí (R109 ⚠), obecné „Po plochu“ (nerovinná nebo nerovnoběžná plocha) – [[M15-export-a-dokonceni#Úkoly z M14|M15]].
- Reference a výběr vrcholů (`PickKind 'vertex'`, R101 ⚠), čipy referencí `topo` v dialogu (R103 ⚠), nesymetrické zkosení a zaoblení s proměnným poloměrem (R105 ⚠).
- Zúžení reference na jednu část rozdělené plochy ([[Q015 Rozdělená plocha a reference|Q015]]), závislost featury na featurách, jejichž jména reference obsahuje (R110 ⚠).

## Implementační plán

Každý úkol dělá zvlášť subagent `implementer` (TDD: test nejdřív a ověřit, že padá; `npm run check`). Kontrakty jsou propsané do specifikací (odkazy u úkolů). Implementátor hlásí odchylky, hlavní sezení je propíše. Seznam souborů je vodítko: sáhnout jinam smí, když to dává smysl, a ohlásí to.

**Paralelní běh:** úkoly jedné vlny mají oddělené soubory a běží souběžně ve vlastních worktree. `index.ts` a `testing.ts` modulu, `src/kernel/kernel.ts`, `src/kernel/types.ts`, `src/kernel/fake-kernel.ts`, `src/kernel-occt/occt-kernel-impl.ts`, `src/regen/builder.ts`, `src/regen/state.ts`, `.dependency-cruiser.cjs`, `tsconfig*.json`, `src/ui/i18n/{cs,en}.ts`, `src/app/session.ts`, `src/app/testing.ts` a `src/app/plugins.ts` smí v dané vlně měnit jen úkol, u kterého jsou uvedené.

**Nové závislosti npm:** žádné. V předpřipraveném buildu je vše potřebné (ověřeno v `replicad_single.d.ts`, R1): `Modified/Generated/IsDeleted` na `BRepBuilderAPI_MakeShape`, `BRepAlgoAPI_BuilderAlgo` a `BRepFilletAPI_MakeFillet/MakeChamfer`, `BRepPrimAPI_MakeBox::TopFace()…`, `BRepPrimAPI_MakeOneAxis::Face()`, `BRepPrimAPI_MakeSweep::FirstShape/LastShape`, `BRepAdaptor_Surface.GetType()/Plane()`, `BRepAdaptor_Curve`, `TopoDS.Edge/Face`, `TopoDS_Shape.Orientation()`, `TopTools_ShapeMapHasher.HashCode`. **Chybí** `TopExp::MapShapesAndAncestors` a `TopTools_IndexedDataMapOfShapeListOfShape` – sousednost hrana → plochy se počítá přes `TopExp_Explorer` a `IsSame` (spec 06). Tabulka modulů v `.dependency-cruiser.cjs` a ve [[01-architektura|spec 01]] se nemění (nové složky `features/fillet` a `features/chamfer` pokrývá vzor `features/*`).

| Vlna | Úkoly (paralelně) | Závisí na |
|---|---|---|
| 0 | Ú0 typy (hlavní sezení) | M13 |
| A | Ú1 jádro · Ú2 `NameTable` · Ú3 porty `interaction` · Ú4 `sketch` · Ú5 `document` | Ú0 |
| B | Ú6 `regen` · Ú7 `render` · Ú8 dialog `interaction` | Ú6 na Ú1, Ú2, Ú4, Ú5; Ú7 na Ú3; Ú8 na Ú3 |
| C | Ú9 pojmenování v pluginech M11 · Ú10 Fillet a Chamfer · Ú11 Po plochu · Ú12 skica na ploše a `TopoInspector` | Ú9–Ú11 na Ú6; Ú12 na Ú8 |
| D | Ú13 `app` + `ui` · Ú14 integrační testy | Ú13 na Ú7, Ú9–Ú12; Ú14 na Ú9–Ú11 |
| E | Ú15 e2e | D |
| F | Ú16 hlavní sezení | E |

Proč vlna 0: typy topologie, `DressupOps` a `Curve2.id` potřebují zároveň jádro (Ú1), čistá jména (Ú2) a skicář (Ú4); jako samotné typy nic nerozbijí a s nimi běží vlna A paralelně (stejně jako M12 vlna 0).

Proč `NameTable` nese topologii (R92): rovina skici na ploše, „Po plochu“ i jména hran potřebují topologii tvaru tělesa; uložená v tabulce dovoluje `BuildContext` odpovídat synchronně a `Body` se kvůli tomu nemění, takže stávající buildery se do vlny C nerozbijí (dostávají dál `EMPTY_NAMES`).

### Vlna 0

#### Ú0 Hlavní sezení: typy
- **Soubory:** `src/kernel/types.ts` (`SurfaceType`, `FacePlane`, `FaceInfo`, `EdgeInfo`, `TopologySummary`), `src/kernel/kernel.ts` (rozhraní `DressupOps`, zatím **mimo** `GeometryKernel`), `src/kernel/profile.ts` (`id?: string` u všech variant `ProfileCurve`, jen typ), `src/kernel/index.ts` (export typů), `src/sketch/geometry.ts` (`id?: string` u `Curve2`, jen typ).
- **Kontrakt:** [[06-geometricke-jadro#Stav po M14]], [[12-skicar#Geometrie a pomůcky editace]].
- **Hotovo když:** `npm run check` projde; žádné chování se nemění.

### Vlna A

#### Ú1 `kernel`, `kernel-occt`: topologie, role, historie, zaoblení a zkosení
Největší úkol milníku; implementátor smí postupovat ve dvou TDD fázích (1. `topology`, role a historie stávajících operací; 2. `DressupOps`) a hlásit po každé.
- **Soubory:** `src/kernel/kernel.ts` (`QueryOps.topology`, `GeometryKernel` += `DressupOps`), `fake-kernel.ts`, `profile.ts` (`parseFaceInput` kopíruje `id`; neprázdný řetězec, jinak chyba vstupu), `testing.ts` (kontraktová sada M14), `index.ts` + testy `fake-kernel.test.ts`, `profile.test.ts`, `index.test.ts`; `src/kernel-occt/occt-kernel-impl.ts`, `shape-entry.ts` (`edgeRoles`), `history.ts` (nový: `collectHistory`), `topology.ts` (nový: `topologyOf`), `face.ts` (role hran), `dressup.ts` (nový), `protocol.ts`, `client.ts`, `worker-impl.ts`, `index.ts` + testy (`occt-topology.test.ts`, `occt-history.test.ts`, `occt-dressup.test.ts` nové, kontraktová sada OCCT, `client.test.ts`/`worker-impl.test.ts` pro nové metody). `src/regen` **nemění** (Ú6).
- **Kontrakt** ([[06-geometricke-jadro#Stav po M14]], [[06-geometricke-jadro#Kontrakt (platí pro každou implementaci)]], [[06-geometricke-jadro#Historie, role a topologie v adaptéru (M14)]], [[06-geometricke-jadro#`FakeKernel`]]):
  ```ts
  export interface QueryOps { boundingBox(shape): Promise<BoundingBox>; topology(shape: ShapeHandle): Promise<TopologySummary> }
  export interface DressupOps {
    fillet(shape: ShapeHandle, edges: readonly number[], radius: number): Promise<ShapeResult>;
    chamfer(shape: ShapeHandle, edges: readonly number[], distance: number): Promise<ShapeResult>;
  }
  export interface GeometryKernel extends PrimitiveOps, TransformOps, BooleanOps, SketchOps, SweepOps, DressupOps, MeshOps, QueryOps, LifecycleOps {}
  export type KernelOp = keyof GeometryKernel;   // failNext/callCount i pro topology, fillet, chamfer
  ```
  - Role: kvádr podle světových os (tabulka v adaptéru, R93), válec, `makeFace` `edge:<id>`, `extrude` `start|end|side:<id>`, `revolve` `side:<id>` (+ `start|end` jen pro úhel < 2π). Role hran profilu u handle, přenos přes `transform`.
  - Historie u `transform`, `boolean`, `extrude`, `revolve`, `fillet`, `chamfer` podle spec 06: jen plochy v `modified`/`deleted`, `generated` z ploch, hran a vrcholů; **úplnost** (každá plocha vstupu právě jednou), indexy vzestupně, pořadí položek podle vstupu, druhu, indexu.
  - `fillet`/`chamfer`: validace, `'operation-failed'` pro všechna selhání algoritmu (i výjimku OCCT z `Build`), vstup platný, nový handle; fake AABB beze změny a identita.
  - Fake: topologie AABB kvádru v pořadí sítě, role a historie podle odrážky spec 06.
- **Testy:** kontraktová sada M14 a OCCT navíc podle [[06-geometricke-jadro#Testy]]; `parseFaceInput` zachová `id` a odmítne prázdné nebo neřetězcové; klient a worker přeposílají `topology`, `fillet`, `chamfer`.
- **Ověřit a ohlásit:** že `BRepBuilderAPI_MakeWire`/`ShapeFix_Face` zachová hrany (`IsSame`) pro role `edge:<id>`; že `BRepFilletAPI_*` hlásí `Generated(hrana)` pro novou plochu; že `MakeRevol` o 2π vrací `FirstShape`, který ve výsledku není; rychlost `collectHistory` (kvádr minus válec, zaoblení) – při > 50 ms zrychlit přes `HashCode`.
- **Hotovo když:** testy a `npm run check` projdou; `createOcctKernel` přeposílá nové metody přes worker; `kernel` exportuje `DressupOps` v `GeometryKernel`.

#### Ú2 `regen`: `NameTable` a `propagateNames`
- **Soubory:** `src/regen/names.ts` (nový), `src/regen/state.ts` (typ `NameTable` a `EMPTY_NAMES` z `names.ts`, `Body` beze změny), `src/regen/index.ts` + testy `names.test.ts` (nový), `state.test.ts`, `index.test.ts`; testy, které porovnávají `EMPTY_NAMES` strukturou (ohlásit).
- **Kontrakt** ([[08-topologicke-pojmenovani#Tabulka jmen a přenos]], [[08-topologicke-pojmenovani#Hrany]], [[08-topologicke-pojmenovani#Vrcholy]], [[0018-format-topologickych-jmen|ADR 0018]]):
  ```ts
  export interface NameTable {
    faces(name: TopoName): readonly number[]; edges(name: TopoName): readonly number[];
    nameOfFace(index: number): TopoName | undefined; nameOfEdge(index: number): TopoName | undefined;
    namesOfFace(index: number): readonly TopoName[];
    readonly faceEntries: ReadonlyMap<TopoName, readonly number[]>;
    readonly edgeEntries: ReadonlyMap<TopoName, readonly number[]>;
    readonly topology: TopologySummary;
  }
  export const EMPTY_NAMES: NameTable;
  export function propagateNames(p: { featureId; inputs: readonly NameTable[]; history?; roles?; topology; generatedTag? }): NameTable;
  ```
  - Pravidla 1–8 spec 08; hrany podle Q014 (základ, kontext vrcholů, `#k` podle středu); vrchol interně; plocha bez jména bez jména; zmrazené, deterministické; jediné přetypování na `TopoName` (komentář).
  - `nameShape` zatím **ne** (Ú6, potřebuje `topology` jádra).
- **Testy** (ručně sestavené `TopologySummary` a `ShapeHistory`, bez jádra): role kvádru → 6 jmen a 12 hran `edge:A|B`; identita přes transform (stejná jména); rozdělení plochy 1 → 2 (jméno na dvou plochách); sloučení (plocha se dvěma jmény, primární podle řazení); zánik; generated z hrany (`face:fillet:edge:…`) a z vrcholu (`vertex:…`); zdroj bez jména se přeskočí; role má přednost před generated; dvě hrany mezi stejnými plochami rozlišené kontextem; nerozlišitelné → `#1`, `#2` podle středu; šev `edge:A|A`; hrana u plochy bez jména bez jména; stejný výsledek při zamíchaném pořadí historie a rolí; index mimo rozsah a neznámý `input` → výjimka; `EMPTY_NAMES` (prázdné, zmrazené).
- **Hotovo když:** testy a `npm run check` projdou; `regen` exportuje `NameTable`, `EMPTY_NAMES`, `propagateNames`.

#### Ú3 `interaction` (+ `render`, `app`): jména v portu, výběr podle jmen, cíl `body`
- **Soubory:** `src/interaction/regen-status-port.ts` (`TopoNames`, `NO_TOPO_NAMES`, `RegenBody.names`), `selection.ts` (jména a přemapování; `bindSelectionHighlight` jen položky `body` → cíl `body`), `viewport-port.ts` (`HighlightTarget` += `body`), `testing.ts` (`FakeRegenStatus.publish` doplní `NO_TOPO_NAMES`, `aTopoNames`), `index.ts` (export `TopoNames`, `NO_TOPO_NAMES`, re-export typu `TopoName`) + testy; `src/render/highlight-layer.ts` / `highlight-targets.ts` – jen zástupné ošetření cíle `body` (vypustit, komentář „Ú7“) + test; `src/app/regen-status-adapter.ts` (`names: NO_TOPO_NAMES`, skutečná jména dodá Ú13) + test.
- **Kontrakt** ([[10-interakce#Port stavu regenerace]], [[10-interakce#Výběr]], [[10-interakce#Port viewportu]]): typy a pravidla podle spec 10 (R102, R104).
- **Testy:** `set` doplní jméno z posledního snapshotu, jméno volajícího se ignoruje; bez tělesa ve snapshotu bez jména; **výběr hrany, nová generace s jinými indexy (jméno na jiném indexu) → položka na novém indexu se stejným jménem**; jméno na dvou plochách → dvě položky na místě původní; zaniklé jméno, zmizelé těleso a položka bez jména vypadnou; `feature`/`body`/`plane` zůstanou; beze změny žádný nový snapshot; `sameSelectionItem` ignoruje `name`; `bindSelectionHighlight` pošle `body` z výběru; `aTopoNames`; adaptér v `app` publikuje `names`.
- **Hotovo když:** testy a `npm run check` projdou; e2e M10–M13 beze změny.

#### Ú4 `sketch`: id křivek v oblastech
- **Soubory:** `src/sketch/regions.ts`, `geometry.ts` (`curve2` vyplní `id`) + testy `regions.test.ts`, `geometry.test.ts`; testy v `features/sketch` a `interaction`, které porovnávají křivky oblastí strukturou (ohlásit).
- **Kontrakt** ([[12-skicar#Oblasti (profily)]]): každá křivka `outer` i `holes` z `computeRegions` má `id` = id entity skici; jména oblastí beze změny.
- **Testy:** obdélník → `outer` má id čtyř úseček; obdélník s kružnicí → díra s id kružnice; drážka s oblouky; jména oblastí stejná jako před změnou.
- **Hotovo když:** testy a `npm run check` projdou.

#### Ú5 `document`: rovina skici jako plocha
- **Soubory:** `src/document/references.ts`, `validate.ts`, `refs.ts` (`readRef` u `topo`: neprázdné `name`) + testy.
- **Kontrakt** ([[03-dokument#Schéma featury]]): `refKindsOf('planes')` → `['plane', 'topo']`; validace, duplicita (`body` + `name`), `referencesOf`, `dependenciesOf` (vlastník tělesa); `topo` s prázdným `name` → `param.invalidRef`.
- **Testy:** podle odrážky M14 v [[03-dokument#Testy]]; skica s `[TopoRef]` na kvádr závisí na kvádru.
- **Hotovo když:** testy a `npm run check` projdou.

### Vlna B

#### Ú6 `regen`: pojmenování v regeneraci a reference na plochy a hrany
- **Soubory:** `src/regen/names.ts` (`nameShape`), `face-plane.ts` (nový: `sketchPlaneOfFace`, `planeOfRef`), `build-context.ts`, `builder.ts` (`ModelingKernel` += `DressupOps`, `BuildContext`, `RefError`, `ResolvedPlane`, `ResolvedTopo`), `body-operation.ts` (`shapes: ShapeResult[]`, jména), `tracking-kernel.ts` (`fillet`, `chamfer`, `topology`), `index.ts`, `testing.ts` (`aBuildContext` s novými metodami, `aNameTable({ faces?, edges?, topology? })` pro testy pluginů) + testy; **volající s minimální změnou** (ohlásit): `src/features/extrude/builder.ts`, `src/features/revolve/builder.ts` (předají `ShapeResult` z `extrude`/`revolve`), `src/features/sketch/builder.ts` (pokud čte z `resolvePlanes` víc než `.plane`), testy, které ručně sestavují `ModelingKernel` (doplnit delegaci `fillet`/`chamfer`/`topology`).
- **Kontrakt** ([[07-regenerace#Builder featury]], [[07-regenerace#Operace tělesa (M13)]], [[08-topologicke-pojmenovani#Reference ve featurách]], [[12-skicar#Roviny a počátek]]):
  ```ts
  export function nameShape(p: { kernel: Pick<QueryOps, 'topology'>; featureId: FeatureId; result: ShapeResult; inputs: readonly NameTable[]; generatedTag?: string }): Promise<NameTable>;
  export type ModelingKernel = PrimitiveOps & TransformOps & BooleanOps & SketchOps & SweepOps & DressupOps & QueryOps;
  // BuildContext +=
  resolvePlanes(refs: readonly (PlaneRef | TopoRef)[]): Result<ResolvedPlane[], RefError>;
  resolveTopo(refs: readonly TopoRef[], entity: 'face' | 'edge'): Result<ResolvedTopo[], RefError>;
  export interface ResolvedPlane { readonly ref: PlaneRef | TopoRef; readonly plane: Plane }
  export interface ResolvedTopo { readonly ref: TopoRef; readonly body: Body; readonly indices: readonly number[] }
  export function sketchPlaneOfFace(face: FacePlane): Plane;
  export function planeOfRef(state: RegenState, ref: PlaneRef | TopoRef): Plane | undefined;
  // applyBodyOperation: shapes: readonly ShapeResult[]
  ```
  - Chybové zprávy a varování přesně podle spec 07/08; `resolvePlanes` u `TopoRef` vezme plochu s nejmenším indexem z `names.faces(name)`, rovinu z `names.topology.faces[i].plane`.
  - `sketchPlaneOfFace`: počátek = průmět `[0, 0, 0]`, `xDir` podle pravidla spec 12, výsledek ortonormální (`plane.isOrthonormal`), zmrazený.
  - `applyBodyOperation`: jména podle odrážky „Jména (M14)“ ve spec 07; `new` s jedním tvarem = jména hranolu.
- **Testy:** podle odrážky M14 v [[07-regenerace#Testy (s `FakeKernel`)]]; `nameShape` s `FakeKernel` (kvádr → `<f>/face:top` na indexu 5); `resolvePlanes` horní plochy kvádru `[0, 10]³` → rovina `origin [0, 0, 10]`, `xDir +X`, `normal +Z`; přední plocha (−Y) → rámec jako `origin/plane:xz` posunutý; `sketchPlaneOfFace` pro šikmou normálu (ortonormální, průmět počátku na rovině); `planeOfRef` (počáteční rovina, plocha, chybějící těleso → `undefined`); extrude a revolve testy z M13 projdou beze změny chování.
- **Hotovo když:** testy a `npm run check` projdou; `regen` exportuje nové funkce a typy.

#### Ú7 `render`: zvýraznění tělesa
- **Soubory:** `src/render/highlight-targets.ts` (čisté: trojúhelníky všech ploch tělesa), `highlight-layer.ts` (nahradí zástupné ošetření z Ú3) + testy.
- **Kontrakt** ([[09-vykreslovani#Vrstvy pro interakci]]): cíl `body` = kopie všech trojúhelníků tělesa materiálem zvýraznění plochy; neplatný cíl (těleso nezobrazené) vypuštěn; porovnání podle `kind` a `body`.
- **Testy:** čistá funkce (počet trojúhelníků = součet ploch, pozice), filtr neplatných cílů, „stejná hodnota“ bez překreslení. Three.js část ručně na dev stránce (ohlásit).
- **Hotovo když:** testy, `npm run check` a `npm run build` projdou.

#### Ú8 `interaction`: `topo` v dialogu
- **Soubory:** `src/interaction/ref-pick-tool.ts`, `ref-values.ts` (`toggleTopoRef`), `tool-manager.ts` (`deps.regen`, předá do `createRefPick`), `selection.ts` (`bindSelectionHighlight` s `editor` a `regen`: `topo` a `bodies`), `index.ts` + testy.
- **Kontrakt** ([[10-interakce#Nástroje]], [[10-interakce#Výběr]]):
  ```ts
  export function toggleTopoRef(value: unknown, ref: TopoRef): readonly TopoRef[];   // jako toggleBodyRef; ne-pole = []
  export function bindSelectionHighlight(selection, highlight, editor?, regen?): Unsubscribe;
  // createToolManager deps += regen?: RegenStatusPort
  ```
  - `refPick` u `topo`: filtr podle `spec.entity` (beze změny), zásah → jméno z posledního snapshotu, bez jména (nebo bez `regen`) nic a hover `null`; druhý klik na tutéž hranu odebere.
  - `bindSelectionHighlight`: pořadí výběr → parametry v pořadí schématu (`region`, `topo`, `bodies`), jen viditelné, bez duplicit; sleduje `regen.state`.
- **Testy:** klik na hranu se jménem přidá `TopoRef`, podruhé odebere; hrana bez jména nic; hover jen se jménem; bez `regen` nic; filtr `topo face` → `['face']`; zvýraznění: dialog Filletu se dvěma hranami → dva cíle `edge`, změna snapshotu (jiné indexy) → nové cíle, skrytý parametr nic, `bodies` v dialogu Booleanu → cíle `body`, zavření session → jen výběr.
- **Hotovo když:** testy a `npm run check` projdou; e2e M10–M13 beze změny.

### Vlna C

#### Ú9 `features/box|cylinder|transform|boolean`: pojmenování
- **Soubory:** `src/features/box/builder.ts`, `cylinder/builder.ts`, `transform/builder.ts`, `boolean/builder.ts` + jejich testy.
- **Kontrakt** ([[07-regenerace#Builder featury]]): každé vytvořené nebo změněné těleso dostane `names = await nameShape({ kernel: ctx.kernel, featureId: feature.id, result, inputs })`; Box a Cylinder `inputs: []`, Transform `[body.names]`, Boolean vstupy v pořadí volání jádra (union: první cíl, ostatní cíle, nástroje; jinak cíle, nástroje). Identita a pořadí mapy beze změny.
- **Testy** (`FakeKernel`): kvádr má `faces('<f>/face:top')` = `[5]` a 12 pojmenovaných hran; válec `top`/`bottom`/`side`; transform zachová jména kvádru; boolean subtract zachová jména cíle (fake: identita prvního vstupu); stávající testy identity projdou.
- **Hotovo když:** testy a `npm run check` projdou; mimo čtyři složky žádná změna.

#### Ú10 `features/fillet`, `features/chamfer`: Zaoblení a Zkosení
- **Soubory:** `src/features/fillet/*`, `src/features/chamfer/*` (nové složky: `index.ts`, `schema.ts`, `builder.ts`, `tool.ts`, `messages.ts`, `<typ>.test.ts`). Do `app/plugins.ts` **nezapisuje** (Ú13). Společný kód obou pluginů se nesdílí importem (pluginy se navzájem importovat nesmí) – zkopírovat, je krátký.
- **Kontrakt** ([[07-regenerace#Builder featury]], R105):
  ```ts
  export interface FilletParams { readonly edges: readonly TopoRef[]; readonly radius: number }      // topo entity 'edge' min 1; length výchozí 1, > 0
  export interface ChamferParams { readonly edges: readonly TopoRef[]; readonly distance: number }   // totéž, distance výchozí 1
  export const filletPlugin: FeaturePlugin<FilletParams>;
  export const chamferPlugin: FeaturePlugin<ChamferParams>;
  ```
  - Schéma `type: 'fillet' | 'chamfer'`, `version: 1`, `label: '<typ>.label'`, labely `<typ>.<param>`; hluboce zmrazené; `validate = validateAgainstSchema`.
  - **Builder:** `resolveTopo(edges, 'edge')` → chyba `unresolvedReference('edges', e)`; seskupit podle tělesa (pořadí prvního výskytu), indexy sjednotit a seřadit; pro každé těleso `fillet(body.shape, indices, radius)` / `chamfer(…, distance)`; těleso `{ ...body, shape, names: await nameShape({ …, inputs: [body.names], generatedTag: 'fillet' | 'chamfer' }), lastModifiedBy: feature.id }` na svém místě v mapě. Chyba jádra proletí (`KERNEL`).
  - **Nástroj:** `id` = typ, `group 'modify'`, Zaoblení se zkratkou `Shift+F` (ověřit, že je volná; jinak bez zkratky a ohlásit), Zkosení bez zkratky; ikony z CSS Tabler (ověřit existenci, návrh `border-radius` a `border-corner-square`); jako `booleanTool` (otevře dialog a skončí).
  - **Texty:** cs „Zaoblení“, „Zkosení“, „Hrany“, „Poloměr“, „Vzdálenost“; en “Fillet”, “Chamfer”, “Edges”, “Radius”, “Distance”.
- **Testy:** společné testy pluginu jako `boolean.test.ts` (výchozí hodnoty validací neprojdou – `edges` `tooFewRefs`, s hranou projdou, R24); builder s `FakeKernel` přes `aBuildContext` a těleso s `aNameTable` (hrana se jménem na indexu 3): jedno volání `fillet` s `[3]` a poloměrem, identita tělesa a `lastModifiedBy`; dvě hrany jednoho tělesa → jedno volání `[3, 7]`; hrany dvou těles → dvě volání v pořadí; neexistující jméno → `UNRESOLVED_REFERENCE` `param: 'edges'`; chybějící těleso; `failNext('fillet', 'operation-failed')` → výjimka proletí; totéž pro chamfer.
- **Hotovo když:** testy a `npm run check` projdou; mimo dvě nové složky žádná změna.

#### Ú11 `features/extrude`: konec „Po plochu“
- **Soubory:** `src/features/extrude/schema.ts`, `builder.ts`, `messages.ts`, `extrude.test.ts`.
- **Kontrakt** (R109 ⚠): `endType` += `'upToFace'` (možnost `extrude.endType.upToFace`), nový parametr `upTo: topo` (`entity: 'face'`, `min: 1`, `max: 1`, `visibleWhen: p => p.endType === 'upToFace'`) **za** `distance`; `distance` viditelné jen pro `blind`/`symmetric`, `flip` jen pro `blind`. `version` zůstává 1 (chybějící skrytý `upTo` je platný). Builder: `resolveTopo(upTo, 'face')` → `unresolvedReference('upTo', e)`; plocha s nejmenším indexem, `plane` z `names.topology`; nerovinná, nerovnoběžná (`|n̂ · d̂| < 1 − 1e-9`) nebo za profilem (`(face.origin − rovina oblasti.origin) · d̂ ≤ 1e-9`) → `{ ok: false, error: { code: 'INVALID_PARAMS', message, issues: [{ param: 'upTo', code: 'extrude.upToFace' }] } }`; jinak `extrude(face, d, vzdálenost)` pro každou oblast se vzdáleností spočítanou od její roviny.
- **Texty:** cs „Po plochu“, „Plocha“ (`upTo`), `extrude.upToFace` „Plocha musí být rovinná, rovnoběžná se skicou a ve směru vysunutí“; en “Up to face”, “Face”, “The face must be planar, parallel to the sketch and in the extrude direction”.
- **Testy:** viditelnost (`upTo` jen pro `upToFace`, `distance` skryté); stará data bez `upTo` projdou; skica na XY, kvádr `z ∈ [5, 15]` jako cíl, „Po plochu“ na jeho spodní plochu (`aNameTable` s rovinou `z = 5`, normála −Z) → bbox hranolu `z ∈ [0, 5]`; plocha za profilem a šikmá plocha → `INVALID_PARAMS` s `upTo`; chybějící jméno → `UNRESOLVED_REFERENCE`.
- **Hotovo když:** testy a `npm run check` projdou; mimo `features/extrude` žádná změna.

#### Ú12 `interaction`: skica na ploše a `TopoInspector`
- **Soubory:** `src/interaction/sketch-editor.ts` (`create(ref)`, `planeOf`, `deps.resolvePlane(ref)`), nástroje skicáře (`sketch` – volba roviny z výběru), `topo-inspector.ts` (nový), `index.ts` + testy.
- **Kontrakt** ([[10-interakce#`SketchEditor` a `SketchSession`]], [[10-interakce#Nástroje a akce skicáře]], [[10-interakce#Ladění jmen: `TopoInspector`]], R107, R108, R111): `SketchEditor.create(plane: PlaneRef | TopoRef)` – u jiné než výchozí roviny `setParam('plane', [ref])`; `planeOf(ref)`; nástroj `sketch` bere první položku `plane`, jinak první `face` se jménem, pro kterou `planeOf` vrátí rovinu, jinak XY; `createTopoInspector` podle spec 10.
- **Testy:** `create` s `TopoRef` zapíše `plane` a session má rovinu z `resolvePlane`; `create` s plochou, kterou `resolvePlane` nezná → výjimka a nic se nezmění; nástroj skici s vybranou pojmenovanou plochou, s plochou bez jména (→ XY), s nerovinnou (`planeOf` `undefined` → XY), s rovinou z Prohlížeče (přednost); `TopoInspector`: vypnutý nepickuje, zapnutý hlásí plochu se jménem, bez jména `name: null`, `leave` → `null`, nová generace → `null`, `dispose` odhlásí.
- **Hotovo když:** testy a `npm run check` projdou.

### Vlna D

#### Ú13 `app`, `ui`: propojení, registrace, ladicí panel
- **Soubory:** `src/app/plugins.ts` (`filletPlugin`, `chamferPlugin` na konec), `regen-status-adapter.ts` (`names: body.names`), `session.ts` (`createToolManager({ …, regen })`, `bindSelectionHighlight(…, features, regen)`, `resolvePlane` přes `planeOfRef` nad posledním `finalState`, `topoInspector` v `AppSession` + `dispose`), `testing.ts` (je-li potřeba) + testy `session.test.ts`, `plugins.test.ts`, `regen-status-adapter.test.ts`; `src/ui/components/TopoDebugPanel.vue` (nový), `TitleBar.vue` (přepínač jen v `import.meta.env.DEV`), `AppShell.vue`, `src/ui/i18n/cs.ts`, `en.ts`.
- **Kontrakt** ([[11-ui#Kompoziční kořen (app)]], [[11-ui#Komponenty]]): podle odrážky M14 ve spec 11. **Překlady:** `debug.topoNames` „Jména ploch“ / “Face names”, `debug.unnamed` „(bez jména)“ / “(unnamed)”, `debug.face` „Plocha {index}“ / “Face {index}”, `debug.edge` „Hrana {index}“ / “Edge {index}”.
- **Testy:** `session.test.ts` s `FakeViewport`, `FakeKernel`: po regeneraci kvádru má `RegenBody.names.faces('<f>/face:top')` = `[5]`; otevřený dialog Zaoblení, klik na hranu (připravený pick) → parametr `edges` s `TopoRef` a `highlight.setSelection` s cílem `edge`; `sketches.create({ kind: 'topo', … })` na horní ploše kvádru → session s rovinou `z = výška`; `topoInspector` je v session a `dispose` ho uvolní; `plugins.test.ts` – devět pluginů bez kolize klíčů.
- **Hotovo když:** testy, `npm run check` a `npm run build` projdou; e2e M10–M13 beze změny.

#### Ú14 `tests`: akceptační scénáře
- **Soubory:** `tests/topo-scenarios.test.ts` (nový).
- **Kontrakt:** propojení jako `tests/extrude-scenario.test.ts` (dokument, dispečer, log, `UndoManager`, `Regenerator`, `FeatureEditor`, pluginy box, cylinder, boolean, sketch, extrude, fillet, chamfer přes `registerPlugin`) s `createInThreadOcctKernel()`; data skici přes `FeatureEditSession.setParams` bez řešiče; jména hran a ploch se do parametrů zadávají **jako řetězce podle spec 08** (test tak ověřuje i formát, ADR 0018).
- **Testy:** scénáře 1–4 ze [[08-topologicke-pojmenovani#Scénáře, které musí fungovat (akceptační testy M14)|spec 08]] (počty ploch z `topology`, bbox, stav featur, `issues`); navíc zkosení hrany kvádru (7 ploch, jedna `<chamfer>/face:chamfer:…`); undo změny výšky ve scénáři 1 vrátí bbox a fillet zůstane bez chyby; `replayLog` do nového dokumentu = stejný `toData`; `liveHandleCount` po scénáři = počet živých handle stavu.
- **Hotovo když:** `npm run test:integration` a `npm run check` projdou.

### Vlna E

#### Ú15 `e2e`: zaoblení přežije změnu rozměru
- **Soubory:** `e2e/m14.spec.ts` (nový), pomocné funkce v `e2e/helpers.ts`.
- **Scénář** (OCCT v prohlížeči, česky, prvky přes role a přístupné názvy):
  1. Nový dokument → „Kvádr“ → „OK“.
  2. „Zaoblení“ → dialog „Zaoblení 1“ s aktivním polem „Hrany“ → klik ve viewportu na horní přední hranu kvádru (souřadnice z pohledu po `fitAll`; pomocná funkce, která najde bod hrany přes projekci, smí jít přes `page.evaluate` jen tehdy, když jiná cesta nejde – ohlásit) → pole ukazuje 1 → „OK“ → Timeline „Zaoblení 1“ bez chyby.
  3. Dvojklik na „Kvádr 1“ → výška na dvojnásobek → „OK“ → Timeline bez chyby („Chyby:“ není), „Zaoblení 1“ stále bez chyby.
  4. „Zpět“ → stav bez chyby; reload po uložení → featury v Timeline, bez chyby.
  5. Konzole bez chyb.
- **Hotovo když:** `npm run test:e2e` projde v Chrome i WebKit; `npm run check`, `npm run build` zelené.

### Vlna F

#### Ú16 Hlavní sezení
- Zkontrolovat kód Ú0–Ú15 proti specifikacím, propsat odchylky (03, 06, 07, 08, 09, 10, 11, 12), převést otázky implementátorů na otázky ve vaultu; spec 08 → `status: implemented`.
- Ověřit, že `interaction` nezná `regen` (jen `TopoNames`), `render` nezná jména, pluginy se navzájem neimportují a `TopoName` razí jen `propagateNames`.
- `architecture-reviewer`, oprava nálezů, retrospektiva, poznatky (kandidáti: topologické pojmenování v praxi – co rozhoduje o stabilitě jmen; historie jádra jako kontrakt s invariantem úplnosti; port jako úzké rozhraní místo sdíleného typu), pojem [[Topologické pojmenování]] doplnit o `NameTable`/`nameShape`, `/milnik konec M14`, commit.

## Co se naučíš

- Jak OCCT popisuje, co se během operace stalo s podtvary (`Modified`, `Generated`, `IsDeleted`), a proč je dobré to převést na data s invariantem úplnosti.
- Proč stačí sledovat historií jen plochy: hrany a vrcholy se pojmenují z okolí a stabilita jmen je tak stabilitou sémantiky featur.
- Jak se z neprůhledného řetězce stane datový kontrakt (ADR 0018) a co to znamená pro budoucí migrace.
- Jak prezentační vrstva pracuje se jmény bez znalosti regenerace – úzké rozhraní portu splněné strukturálně.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení)_
