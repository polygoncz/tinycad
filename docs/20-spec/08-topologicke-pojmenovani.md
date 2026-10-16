---
type: spec
status: implemented
order: 8
aliases:
  - Topologické pojmenování
  - Spec 08
modules:
  - regen
  - kernel
  - kernel-occt
  - document
  - interaction
milestones:
  - "[[M14-topologicke-pojmenovani]]"
tags:
  - spec
created: 2026-10-12
updated: 2026-10-14
---
# 08 – Topologické pojmenování

> **Pojmy:** [[Topologické pojmenování]], [[Těleso]], [[Geometrické jádro]]  
> **Rozhodnutí:** [[0007-vlastni-topologicke-pojmenovani]], [[0018-format-topologickych-jmen]], [[Q014 Více hran mezi dvěma plochami|Q014]], [[Q015 Rozdělená plocha a reference|Q015]]  
> **Milník:** [[M14-topologicke-pojmenovani]]

> Stav: implementováno v M14 (kontrakt v [[M14-topologicke-pojmenovani#Implementační plán]], rozhodnutí R91–R120 a oprava revize v [[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování]]). Do M14 existovaly jen reference na celá tělesa (`BodyRef`), oblasti, roviny a osy.

## Problém

Featury se odkazují na geometrii předchozích featur: fillet na hrany, skica na plochu. Při každé regeneraci ale jádro vytvoří **nové** tvary a indexy ploch/hran se mohou přeházet. Uložit si index nebo handle proto nejde. Potřebujeme **jméno**, které:

- vznikne deterministicky z historie modelování, ne z pořadí v paměti,
- přežije změnu parametrů (kvádr vyšší → horní plocha je pořád „horní plocha kvádru“),
- při ztrátě entity selže hlasitě (chyba featury), nikdy tiše nepřeskočí na jinou entitu.

Vlastní implementace místo OCAF/TNaming je záměrná – chceme pochopit mechanismus ([[0007-vlastni-topologicke-pojmenovani|ADR 0007]]).

Celý tok v jedné větě: **jádro** vrací ke každému tvaru role (u primitiv a featur ze skici) a historii ploch (u operací se vstupy), **`regen`** z nich a z topologie výstupu čistou funkcí sestaví tabulku jmen tělesa, **builder** podle ní převádí uložené `TopoRef` na indexy a **`interaction`** převádí index z pickingu zpět na jméno.

## Jména

```ts
export type TopoName = Brand<string, 'TopoName'>;   // definováno v document
```

Formát je datový kontrakt ([[0018-format-topologickych-jmen|ADR 0018]]): jméno se ukládá v `TopoRef.name` do dokumentu. Jméno je **neprůhledný řetězec** – porovnává se a ukládá, nikdy se nerozebírá (ani v `dependenciesOf`, ani v UI). Razí ho jediné místo, `propagateNames` v `regen/names.ts` (jediné přetypování na `TopoName`). Řazení jmen = výchozí `Array.prototype.sort()` (kódové jednotky UTF-16), nikdy `localeCompare`.

### Plochy

Plochu pojmenuje featura, která ji **vytvořila**, podle své sémantiky. Role vrací jádro v `ShapeResult.roles` bez prefixu (`'face:top'`), `propagateNames` přidá `<featureId>/`:

| Featura | Jména ploch |
|---|---|
| Box | `<fid>/face:top` (+Z), `…:bottom` (−Z), `…:front` (−Y), `…:back` (+Y), `…:left` (−X), `…:right` (+X) – podle **světových os**, ne podle jmen OCCT (`BRepPrimAPI_MakeBox::FrontFace()` je XMax, `LeftFace()` YMin; [[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R93]]) |
| Cylinder | `<fid>/face:bottom` (podstava v `base`), `…:top` (podstava v `base + height·â`), `…:side` (plášť, `BRepPrimAPI_MakeOneAxis::Face()`) |
| Extrude | `<fid>/face:start` (profil, `FirstShape()`), `…:end` (`LastShape()`), `…:side:<entityId>` (boční plocha z hrany profilu, `Generated(hrana)`) |
| Revolve | `<fid>/face:side:<entityId>`; `…:start`, `…:end` jen pro úhel < 2π (při plné otáčce ve výsledku nejsou) |
| Fillet | `<fid>/face:fillet:<jméno zaoblené hrany>`, v rozích `…:fillet:vertex:…` (generated z vrcholu) |
| Chamfer | `<fid>/face:chamfer:<jméno hrany>` |
| Transform, Boolean | žádná nová jména; plochy dědí jména vstupů (boolean výjimečně `…:gen:<zdroj>`) |

- **Plocha vzniklá z podtvaru vstupu** (`generated`) bez role: `<fid>/face:<tag>:<primární jméno zdroje>`; `tag` předá builder (`fillet`, `chamfer`, výchozí `gen`). Zdroj bez jména se přeskočí.
- **Vazba hran profilu na entity skici** (M14, [[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R98]]): profil je v jádře hotová plocha ([[Rozhodnutí noční rychloakce#M12 – Skicář|R35]]), takže jen jádro ví, která hrana je která. `computeRegions` (od M30 `regionCurves` a jádro, `SketchOps.profileRegions`) vyplní u křivek oblastí `id` entity skici (`Curve2.id`), `makeFace` je převezme (`ProfileCurve.id`), vrátí role `edge:<id>` a **pamatuje si je u handle** (i po `transform`); `extrude`/`revolve` z nich spočítají `face:side:<id>`. Jména skicových entit jsou stabilní id ze skicáře ([[12-skicar|12]]), proto jsou stabilní i boční plochy.
- **Víc oblastí v jedné featuře:** `face:start`, `face:end` (a boční plochy, pokud oblasti sdílí entitu) ukazují na víc ploch – jména podle oblasti se nerozlišují ([[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R99]] ⚠). Přidání oblasti tak nepřejmenuje existující plochy.
- Po „přidat/odebrat“ (boolean v `applyBodyOperation`) se jména přenesou historií booleanu jako u featury Boolean.

### Hrany

Hrana se jmenuje podle **dvou sousedních ploch** – hrany se historií nesledují, stačí jména ploch a sousednost z `kernel.topology()` ([[06-geometricke-jadro#Stav po M14]]). Pravidla ([[Q014 Více hran mezi dvěma plochami|Q014]], [[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R95]] ⚠):

1. **Základ:** `edge:<A>|<B>`, kde A ≤ B jsou primární jména (`nameOfFace`) sousedních ploch. Hrana s jedinou sousední plochou (šev pláště válce) → `edge:<A>|<A>`. Sousední plocha bez jména → hrana bez jména.
2. Má-li základ jediná hrana, je to její jméno.
3. Jinak **kontext:** pro každou hranu skupiny seřazená jména (primární, bez duplicit) všech ploch, které se dotýkají jejích koncových vrcholů, bez A a B; jméno `edge:<A>|<B>[<C>,<D>]` (prázdný kontext `[]`). Plochy kolem vrcholu = sousední plochy všech hran, které vrchol obsahují. Plochy bez jména se do kontextu nepočítají ([[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R115]]).
4. Jsou-li ani teď jména shodná, dostanou `#1`, `#2`… (`edge:<A>|<B>[…]#2`) v pořadí středu hrany (`EdgeInfo.midpoint`, lexikograficky x, y, z; shoda do 1e-9 → pořadí indexu). Geometrické, a tedy křehké – jen poslední záchrana.

### Vrcholy

Jméno vrcholu `vertex:<A>|<B>|<C>…` (seřazená primární jména všech ploch kolem vrcholu, bez duplicit; je-li kolem vrcholu plocha bez jména, vrchol jméno nemá, R115) vzniká jen **interně** jako zdroj pro plochy `generated` z vrcholu (rohy zaoblení). `NameTable` vrcholy nevystavuje a výběr vrcholů není ([[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R101]] ⚠): žádná featura M14 na vrchol neodkazuje.

### Plocha bez jména

Plocha, které žádné pravidlo jméno nedá (zdroj bez jména, chybějící historie), **zůstane bez jména** ([[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R97]]): `nameOfFace` vrátí `undefined`, hrany kolem ní také nemají jméno. Odkázat se na ni nejde (zásah v dialogu se ignoruje), ladicí panel ukáže „bez jména“. Náhradní jméno podle indexu nevzniká – po regeneraci by tiše ukázalo na jinou plochu.

## Topologie tvaru

Jména hran, rovina skici na ploše i „Po plochu“ potřebují topologii výstupu. Vrací ji jádro jedním dotazem `QueryOps.topology(shape)` (typy v [[06-geometricke-jadro#Stav po M14]]): typ plochy (`'plane' | 'cylinder' | …`), u rovinné plochy rovina s normálou ven z tělesa, u hrany sousední plochy, koncové vrcholy a střed. Tabulka jmen si topologii, ze které vznikla, nese s sebou (`NameTable.topology`), takže `BuildContext` odpovídá synchronně a bez dalších volání jádra ([[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R92]]).

## Tabulka jmen a přenos

```ts
// regen/names.ts (veřejné API regen)
export interface NameTable {
  /** Indexy ploch se jménem, vzestupně; neznámé jméno → []. */
  faces(name: TopoName): readonly number[];
  edges(name: TopoName): readonly number[];
  /** Primární jméno: první ze jmen plochy podle řazení; bez jména (i index mimo rozsah) → undefined. */
  nameOfFace(index: number): TopoName | undefined;
  nameOfEdge(index: number): TopoName | undefined;
  /** Všechna jména plochy, seřazená; [] = bez jména. Pro přenos sloučených ploch. */
  namesOfFace(index: number): readonly TopoName[];
  /** Jméno → indexy, klíče v pořadí řazení jmen. */
  readonly faceEntries: ReadonlyMap<TopoName, readonly number[]>;
  readonly edgeEntries: ReadonlyMap<TopoName, readonly number[]>;
  /** Topologie tvaru, ze které tabulka vznikla. */
  readonly topology: TopologySummary;
}

/** Bez jmen, topologie s 0 plochami, 0 hranami a 0 vrcholy; zmrazené. */
export const EMPTY_NAMES: NameTable;

export function propagateNames(p: {
  readonly featureId: FeatureId;
  /** Tabulky vstupních tvarů; index = HistoryLink.input. Vstup bez jmen (plocha profilu) = EMPTY_NAMES. */
  readonly inputs: readonly NameTable[];
  readonly history?: ShapeHistory;
  readonly roles?: Readonly<Record<string, readonly SubShapeIndex[]>>;
  /** Topologie výstupního tvaru. */
  readonly topology: TopologySummary;
  /** Značka jmen ploch z generated; výchozí 'gen'. */
  readonly generatedTag?: string;
}): NameTable;

/** Jediné, co builder volá: kernel.topology(result.shape) a propagateNames. */
export function nameShape(p: {
  readonly kernel: Pick<QueryOps, 'topology'>;
  readonly featureId: FeatureId;
  readonly result: ShapeResult;
  readonly inputs: readonly NameTable[];
  readonly generatedTag?: string;
}): Promise<NameTable>;
```

Pravidla `propagateNames`:

1. **Role:** klíč `face:<role>` → jméno `<featureId>/face:<role>` pro všechny plochy role. Klíče jiných druhů (`edge:<id>` z `makeFace`) se ignorují.
2. **Přežila beze změny nebo byla upravena** (`modified` od plochy, včetně identity): výstupní plochy dědí **všechna** jména vstupní plochy (`inputs[input].namesOfFace(from.index)`).
3. **Rozdělila se** (jedna vstupní → více výstupních): všechny dědí stejná jména; jméno pak ukazuje na víc ploch ([[Q015 Rozdělená plocha a reference|Q015]]).
4. **Nově vzniklá** (`generated` z plochy, hrany nebo vrcholu vstupu): výstupní plocha, která nemá roli z bodu 1, dostane `<featureId>/face:<generatedTag>:<primární jméno zdroje>`. Jméno zdroje: plocha → `nameOfFace`, hrana → `nameOfEdge`, vrchol → `vertex:…` z `inputs[input].topology`. Zdroj bez jména se přeskočí.
5. **Zanikla** (`deleted`): jméno zmizí.
6. **Sloučení:** výstupní plocha, která dostala víc jmen, je drží všechna; `nameOfFace` vrátí první podle řazení.
7. **Hrany** se pojmenují až nakonec z primárních jmen ploch výstupu a `topology` podle pravidel v [[#Hrany]].
8. Index mimo rozsah výstupu nebo vstupu, neznámý `input` → výjimka (chyba adaptéru, ne uživatele). Index vstupu se kontroluje jen u vstupu s neprázdnou topologií: vstup bez jmen (`EMPTY_NAMES` za plochu profilu) topologii nemá, ale historie tažení na něj odkazuje ([[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R114]]).

Funkce je **čistá** a deterministická (výsledek nezávisí na pořadí položek v historii ani v `roles`), výsledek je zmrazený (`Object.freeze` tabulky a polí indexů; `faceEntries`/`edgeEntries` jsou uvnitř obyčejné `Map`, zmrazené jen typem `ReadonlyMap` – [[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|oprava revize M14]] ⚠) a testuje se bez jádra na ručně sestavené historii. Adaptér jádra musí v historii vracet **každou plochu každého vstupu právě jednou** – v `modified` (i identitu) nebo v `deleted` –, aby TypeScriptová strana nic neodvozovala; kontraktová sada to ověřuje pro obě jádra ([[06-geometricke-jadro#Kontrakt (platí pro každou implementaci)]]).

`Body.names` je tabulka jmen aktuálního tvaru tělesa. Featura, která těleso **mění**, ji přepočítá přes `nameShape` (vstupy = tabulky vstupních tvarů v pořadí, v jakém je předala jádru), nekopíruje ji ([[07-regenerace#Builder featury]], [[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R113]]).

## Reference ve featurách

```ts
export interface TopoRef { readonly kind: 'topo'; readonly body: BodyId; readonly name: TopoName }

// BuildContext (regen, spec 07) +=
resolveTopo(refs: readonly TopoRef[], entity: 'face' | 'edge'): Result<ResolvedTopo[], RefError>;
export interface ResolvedTopo { readonly ref: TopoRef; readonly body: Body; readonly indices: readonly number[] }   // indices vzestupně, ≥ 1
```

Vyhodnocení v `BuildContext.resolveTopo` (v pořadí `refs`, první chyba vyhrává):

| Počet nalezených entit | Výsledek |
|---|---|
| těleso chybí / jiný druh artefaktu | err `Body '<b>' does not exist` / `'<b>' is not a body` |
| 0 | err `Face '<jméno>' not found on body '<b>'` (`Edge …` u hran) → builder vrátí `unresolvedReference(param, e)` = `UNRESOLVED_REFERENCE` (featura zčervená, uživatel referenci opraví v dialogu) |
| 1 | OK |
| > 1 | u ploch: `ctx.warn('Reference '<jméno>' matches <n> faces; all are used')` + použijí se všechny (u `resolvePlanes` `…; the first is used`, viz níže); u hran: použijí se všechny bez varování (obvykle chtěné) |

Rovina skici na ploše a konec „Po plochu“ potřebují jedinou rovinnou plochu: `resolvePlanes` přijímá i `TopoRef` ([[07-regenerace#Builder featury]]), vezme plochu s nejmenším indexem (víc ploch → varování `Reference '<jméno>' matches <n> faces; the first is used`) a nerovinná plocha je err `Face '<jméno>' is not planar`. Builder každou chybu `resolvePlanes` převede na `unresolvedReference(param, e)`, takže nerovinná plocha u „Po plochu“ je `UNRESOLVED_REFERENCE` u `upTo` (ne `INVALID_PARAMS` jako v plánu Ú11 ⚠); `INVALID_PARAMS` zbývá jen pro rovinnou plochu, která není rovnoběžná se skicou nebo ve směru vysunutí ([[07-regenerace#Operace tělesa (M13)]]). Rámec roviny skici na ploše určuje čistá funkce `sketchPlaneOfFace` ([[12-skicar#Roviny a počátek]], [[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R106]]).

Reference `topo` vytváří závislost jen na vlastníkovi tělesa (`ownerOf` → `originOfBody(ref.body)`), ne na featurách, jejichž jména obsahuje (díra z válce) – jména se nerozebírají ([[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R110]] ⚠).

## Z výběru na referenci

Picking vrátí `{ body, faceIndex }` nebo `{ body, edgeIndex }` (index v aktuálním tvaru). `render` jména nezná. `interaction` je dostane přes port stavu regenerace: `RegenBody.names: TopoNames` – úzké rozhraní definované v `interaction`, které `NameTable` strukturálně splňuje ([[10-interakce#Port stavu regenerace]], [[0011-programovani-proti-rozhranim|ADR 0011]]).

- **Dialog:** `refPick` převede zásah plochy/hrany na `TopoRef` přes `names.nameOfFace(index)` / `nameOfEdge(index)` a přidá ho do parametru `topo` (stejná reference znovu ho odebere); zásah bez jména se ignoruje. Vybrané hrany a plochy aktivního dialogu jsou zvýrazněné ve viewportu ([[10-interakce#Výběr]]).
- **Výběr přežije regeneraci** (nahrazuje pravidlo z [[Q064 Výběr po regeneraci|Q064]]): `SelectionModel` si k položce `face`/`edge` doplní jméno z posledního snapshotu; po nové generaci položky přemapuje podle jména (jméno na víc ploch → všechny), vypadnou jen ty, jejichž jméno nebo těleso zaniklo.
- **Skica na ploše:** vybraná rovinná plocha a „Skica“ → `SketchParams.plane = [TopoRef]` ([[12-skicar#Režim skicáře (sketcher)]]).

## Ladění

Ladicí panel jmen ([[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R111]]): `TopoInspector` v `interaction` při zapnutí sám pickuje pod kurzorem (výchozí filtr) a vystavuje `{ body, kind, index, name }`; `ui` ho ukazuje v malém panelu za přepínačem, který je jen ve vývojovém buildu ([[10-interakce#Ladění jmen: `TopoInspector`]], [[11-ui#Komponenty]]). Výborné pro pochopení, jak jména vznikají.

## Scénáře, které musí fungovat (akceptační testy M14)

Integrační testy s OCCT v Node (`createInThreadOcctKernel`, [[M14-topologicke-pojmenovani#Implementační plán]]); `<box>` = id featury kvádru atd.

1. **Fillet přežije změnu rozměru:** kvádr 10 × 10 × 10 v počátku; Fillet na hraně `edge:<box>/face:front|<box>/face:top` (r = 1) → těleso má 7 ploch, jednu s jménem `<fillet>/face:fillet:edge:<box>/face:front|<box>/face:top`; změna výšky kvádru na 20 → fillet bez chyby, 7 ploch, bbox `z ∈ [0, 20]`.
2. **Skica na ploše:** skica na `<box>/face:top` s obdélníkem uvnitř plochy, vysunutí „přidat“ do kvádru o 5 → bez chyby, bbox `z ∈ [0, 15]`; změna výšky kvádru na 20 → skica i vysunutí bez chyby, rovina skici `z = 20`, bbox `z ∈ [0, 25]`.
3. **Fillet na hraně díry:** kvádr minus válec, který jím prochází (díra), fillet na hraně `edge:<box>/face:top|<cyl>/face:side` (r = 0,5); posun válce (změna `base`) → fillet bez chyby, stejný počet ploch.
4. **Smazaná reference:** ve scénáři 1 s dalším nezávislým válcem smazání kvádru → Fillet `UNRESOLVED_REFERENCE` s `issues` `[{ param: 'edges', code: 'param.unresolvedRef' }]`, válec bez chyby a dál ve stavu.

## Srovnání s jinými přístupy

- **Onshape:** reference jsou dotazy (queries) ve FeatureScriptu vyhodnocované při regeneraci – principiálně podobné, ale mnohem bohatší.
- **FreeCAD 1.0:** „element map“ s jmény odvozenými z historie operací (algoritmus realthundera) – nejbližší našemu přístupu.
- **OCCT OCAF/TNaming:** obecný framework, který dělá totéž přes atributy v datovém stromu. Mocný, ale skrývá mechanismus.

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
