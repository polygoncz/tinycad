---
type: spec
status: outline
order: 8
aliases:
  - Topologické pojmenování
  - Spec 08
modules:
  - regen
  - kernel-occt
  - document
milestones:
  - "[[M14-topologicke-pojmenovani]]"
tags:
  - spec
created: 2026-10-12
updated: 2026-10-14
---
# 08 – Topologické pojmenování

> **Pojmy:** [[Topologické pojmenování]], [[Těleso]], [[Geometrické jádro]]  
> **Rozhodnutí:** [[0007-vlastni-topologicke-pojmenovani]]  
> **Milník:** [[M14-topologicke-pojmenovani]]

> Stav: návrh pro milník M14. Do té doby existují jen reference na celá tělesa (`BodyRef`).

## Problém

Featury se odkazují na geometrii předchozích featur: fillet na hrany, skica na plochu. Při každé regeneraci ale jádro vytvoří **nové** tvary a indexy ploch/hran se mohou přeházet. Uložit si index nebo handle proto nejde. Potřebujeme **jméno**, které:

- vznikne deterministicky z historie modelování, ne z pořadí v paměti,
- přežije změnu parametrů (kvádr vyšší → horní plocha je pořád „horní plocha kvádru“),
- při ztrátě entity selže hlasitě (chyba featury), nikdy tiše nepřeskočí na jinou entitu.

Vlastní implementace místo OCAF/TNaming je záměrná – chceme pochopit mechanismus ([[0007-vlastni-topologicke-pojmenovani|ADR 0007]]).

## Jména

```ts
export type TopoName = Brand<string, 'TopoName'>;   // definováno v document
```

### Plochy

Plochu pojmenuje featura, která ji **vytvořila**, podle své sémantiky:

| Featura | Jména ploch |
|---|---|
| Box | `<fid>/face:top`, `…:bottom`, `…:front`, `…:back`, `…:left`, `…:right` (z `BRepPrimAPI_MakeBox::TopFace()` atd.) |
| Cylinder | `<fid>/face:top`, `…:bottom`, `…:side` |
| Extrude | `<fid>/face:start`, `…:end`, `…:side:<sketchEntityId>` (boční plocha podle hrany skici, ze které vznikla) |
| Revolve | `<fid>/face:side:<sketchEntityId>`, případně `…:start`, `…:end` |
| Fillet | `<fid>/face:fillet:<jméno zaoblené hrany>` |

Jména skicových entit jsou stabilní ID ze skicáře ([[12-skicar|12]]), proto jsou stabilní i boční plochy extrude.

Stav po [[M13-extrude-revolve|M13]]: Vysunutí a Rotace existují, ale jádro `roles` nevrací ([[Rozhodnutí noční rychloakce#M13 – Extrude a Revolve|R64]] ⚠). Pro `face:side:<entita>` musí M14 nejdřív u `makeFace` vrátit vazbu hran plochy na id křivek skici (role hran `edge:<entita>`), protože profil je v jádře hotová plocha; start a konec dá `BRepPrimAPI_MakeSweep::FirstShape()`/`LastShape()`, boční plochy `Generated(hrana)`. Role samy nestačí: po „přidat/odebrat“ (boolean v `applyBodyOperation`) je potřeba i historie booleanu.

### Hrany a vrcholy

Hrana se jmenuje podle **dvou sousedních ploch**, vrchol podle tří:

```
edge:<jméno plochy A>|<jméno plochy B>        (jména seřazená abecedně)
vertex:<A>|<B>|<C>
```

Výhoda: hrany se nemusí sledovat historií zvlášť, stačí jména ploch a topologie sousednosti (kterou vrací `kernel.topology()`). Když dvě plochy sdílí víc hran (např. šev válce), přidá se pořadový index podle deterministického kritéria (pořadí podél osy, délka) – viz otevřené otázky.

## Přenos jmen přes operace

Každá operace jádra vrací historii ([[06-geometricke-jadro|06]]). Builder z ní sestaví novou tabulku jmen:

```ts
export interface NameTable {
  faces(name: TopoName): readonly number[];       // indexy ploch v aktuálním tvaru
  nameOfFace(index: number): TopoName | undefined;
  readonly entries: ReadonlyMap<TopoName, readonly number[]>;
}

export function propagateNames(
  inputs: readonly { names: NameTable }[],     // tabulky vstupních těles
  history: ShapeHistory,                       // co se stalo s plochami vstupů
  created: Readonly<Record<string, number[]>>, // nové plochy pojmenované featurou (roles z jádra)
  featureId: FeatureId,
): NameTable;
```

Pravidla:
1. **Přežila beze změny nebo byla upravena** (`modified`, včetně identity): výstupní plocha dědí jméno vstupní plochy.
2. **Rozdělila se** (jedna vstupní → více výstupních): všechny dědí stejné jméno. Jméno pak ukazuje na víc ploch.
3. **Nově vzniklá** (`generated` nebo `roles`): dostane jméno od featury.
4. **Zanikla** (`deleted`): jméno zmizí.
5. Výstupní plocha, která by dostala dvě jména (sloučení ploch), si ponechá obě – tabulka mapuje jméno → plochy, ne naopak; `nameOfFace` vrátí první podle abecedy.

Adaptér jádra musí v historii vracet i nezměněné plochy (identitu), aby TypeScriptová strana nemusela nic odvozovat.

`propagateNames` je **čistá funkce** – testuje se bez jádra na ručně sestavené historii.

## Reference ve featurách

```ts
export interface TopoRef { readonly kind: 'topo'; readonly body: BodyId; readonly name: TopoName }
```

Vyhodnocení v `BuildContext.resolveTopo`:

| Počet nalezených entit | Výsledek |
|---|---|
| 0 | chyba featury `UNRESOLVED_REFERENCE` (featura zčervená, uživatel referenci opraví v dialogu) |
| 1 | OK |
| > 1 | u ploch: varování + použijí se všechny; u hran pro fillet: použijí se všechny (obvykle chtěné) |

## Z výběru na referenci

Picking vrátí `{ bodyId, faceIndex }` (index v aktuálním tvaru). Dialog featury ho převede na `TopoRef` přes `body.names.nameOfFace(faceIndex)`. Pro hranu přes dvojici sousedních ploch.

## Scénáře, které musí fungovat (akceptační testy M14)

1. Fillet na hraně `box/face:top|box/face:front`, pak změna výšky kvádru → fillet drží.
2. Skica na `box/face:top`, extrude ze skici; změna rozměru kvádru → skica i extrude drží.
3. Kvádr minus válec (díra), fillet na hraně díry; posun válce → fillet drží.
4. Smazání featury, na kterou se odkazuje → navazující featura je červená s čitelnou chybou, zbytek modelu je v pořádku.

## Srovnání s jinými přístupy

- **Onshape:** reference jsou dotazy (queries) ve FeatureScriptu vyhodnocované při regeneraci – principiálně podobné, ale mnohem bohatší.
- **FreeCAD 1.0:** „element map“ s jmény odvozenými z historie operací (algoritmus realthundera) – nejbližší našemu přístupu.
- **OCCT OCAF/TNaming:** obecný framework, který dělá totéž přes atributy v datovém stromu. Mocný, ale skrývá mechanismus.

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
