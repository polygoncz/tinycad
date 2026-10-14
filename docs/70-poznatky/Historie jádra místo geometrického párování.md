---
type: insight
status: seed
aliases:
  - Jména z historie jádra
topics:
  - topologické pojmenování
  - OpenCascade
sources:
  - "[[0007-vlastni-topologicke-pojmenovani]]"
  - "[[08-topologicke-pojmenovani]]"
  - "[[0018-format-topologickych-jmen]]"
tags:
  - poznatek
created: 2026-10-14
updated: 2026-10-14
---
# Historie jádra místo geometrického párování

**Shrnutí:** plochy po regeneraci je stabilnější pojmenovat z toho, co jádro hlásí o průběhu operace (role primitiv, `Modified`/`Generated`/`IsDeleted`), než je dohledávat porovnáním geometrie starého a nového tvaru.

## Podrobnosti

Při [[Topologické pojmenování|topologickém pojmenování]] jsou dvě cesty:

- **Geometrické párování:** po regeneraci se pro uloženou plochu hledá v novém tvaru „nejpodobnější“ plocha (typ, normála, těžiště, obsah). Funguje u malých změn, ale přesně u změny parametru, kvůli které se regeneruje, selhává: vyšší kvádr má horní plochu jinde, posunutý válec dělá díru jinde. Tolerance je vždy kompromis mezi „nenašlo“ a „našlo jinou“ – a tichý přeskok na jinou plochu je to nejhorší, co se může stát.
- **Historie jádra:** jádro ví, co během operace s každou plochou udělalo. OCCT to vystavuje na algoritmech (`BRepBuilderAPI_MakeShape`, `BRepAlgoAPI_BuilderAlgo`, `BRepFilletAPI_*`): `Modified(f)` – na které plochy výstupu se vstupní plocha změnila, `Generated(s)` – které plochy vznikly z hrany nebo vrcholu, `IsDeleted(f)` – zanikla. Primitiva a tažení navíc znají **role** (`TopFace()`, `FirstShape()`/`LastShape()`, `Generated(hrana profilu)`).

Jméno tak plyne ze **sémantiky featury** (`<box>/face:top`, `<fillet>/face:fillet:<hrana>`), ne z polohy. Přenáší se přes operace podle historie a hrany se jmenují podle sousedních ploch, takže stačí sledovat jen plochy. Stabilita jmen je pak stabilitou sémantiky: změna rozměru jméno nezmění, protože kvádr má horní plochu pořád.

Klíčový je **invariant úplnosti**: adaptér vrací každou plochu každého vstupu právě jednou (v `modified`, i identitu, nebo v `deleted`). TypeScriptová strana nic neodvozuje a kontraktová sada to ověří pro každé jádro. Převod na čistá data dovolí testovat pravidla přenosu bez jádra, na ručně sestavených historiích.

**Kde to drhne:**

- **Rozdělená plocha** – boolean rozřízne plochu na dvě, obě zdědí stejné jméno; reference pak ukazuje na víc ploch a výběr jedné z nich by potřeboval další pravidlo ([[Q015 Rozdělená plocha a reference|Q015]]).
- **Víc hran mezi dvěma plochami** – jméno z dvojice sousedních ploch nestačí; rozliší je kontext ploch u koncových vrcholů a teprve jako poslední záchrana pořadí podle středu, tedy zase geometrie ([[Q014 Více hran mezi dvěma plochami|Q014]]).
- **Mezery v historii jádra** – OCCT u rotace o 2π nevrací `Generated` pro hranu kolmou na osu, takže boční plocha se hledá náhradně podle kružnic z vrcholů hrany ([[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R118]]). Historie je kontrakt jádra a jeho díry se musí najít testy adaptéru.

## Jak to využívá tinycad

Jádro vrací role a historii v `ShapeResult` ([[06-geometricke-jadro]]), `propagateNames` v `regen` z nich čistou funkcí sestaví `NameTable` a builder ji přepočítá přes `nameShape` ([[08-topologicke-pojmenovani]]). Formát jmen je datový kontrakt ([[0018-format-topologickych-jmen|ADR 0018]]), vlastní implementace místo OCAF/TNaming je záměrná ([[0007-vlastni-topologicke-pojmenovani|ADR 0007]]). Akceptační scénáře M14 prošly napoprvé, protože pravidla byla otestovaná na datech dřív, než se potkala s OCCT ([[M14-topologicke-pojmenovani#Retrospektiva]]).

Onshape řeší totéž dotazy vyhodnocovanými při regeneraci – principiálně stejná myšlenka „reference je recept, ne index“ ([[Jak Onshape modeluje s historií]]).

## Zdroje

- [[0007-vlastni-topologicke-pojmenovani|ADR 0007]] – proč vlastní pojmenování
- [[08-topologicke-pojmenovani|Spec 08]] – pravidla `propagateNames`, hrany, scénáře
- [[0018-format-topologickych-jmen|ADR 0018]] – formát jmen
