---
type: milestone
status: todo
order: 16
aliases:
  - M16
  - M16 Vlastní OCCT build
modules:
  - kernel-occt
specs:
  - "[[06-geometricke-jadro]]"
depends_on:
  - "[[M07-kernel-occt]]"
started:
finished:
tags:
  - milnik
created: 2026-10-13
updated: 2026-10-15
---
# M16 – Vlastní OCCT build

**Cíl:** nahradit předpřipravený `replicad-opencascadejs` vlastním C++ modulem přeloženým přes Emscripten a embind, s úzkým API přesně podle portu `GeometryKernel`. Zbytek aplikace se nezmění.

> Hrubý plán – před zahájením upřesnit.

**Specifikace:** [[06-geometricke-jadro#Volba WASM buildu OCCT (spike v M7)|06 – volba WASM buildu]], [[0013-replicad-opencascadejs|ADR 0013]]

**Návrat do plánu (Pavel 2026-10-14):** po [[M21-vstupni-stav-editovane-featury|M21]], kvůli zásobníku Emscriptenu (A7). Od 2026-10-15 až po režimech zobrazení [[M22-rezimy-zobrazeni|M22]]–[[M24-realisticke-zobrazeni|M24]].

**Navazuje na:** [[M07-kernel-occt]]. Technicky stačí hotové M7, v roadmapě je zařazený až za [[M15-export-a-dokonceni|M15]]. Dřív se vyplatí, pokud předpřipravenému buildu bude chybět třída (např. pro [[M14-topologicke-pojmenovani|M14]]) nebo když bude pomalé počítání map podtvarů ([[0013-replicad-opencascadejs#Důsledky|ADR 0013]]).

## Úkoly (orientačně)

- [ ] Build OCCT pro Emscripten v Dockeru (`emscripten/emsdk`): jen potřebné toolkity (`TKernel`, `TKMath`, `TKBRep`, `TKG2d/3d`, `TKGeomBase`, `TKTopAlgo`, `TKPrim`, `TKBO`, `TKFillet`, `TKMesh`, `TKSTEP*`), skript v repu, cache výstupu.
- [ ] C++ jádro `TinyKernel`: tabulka handle a `ShapeEntry` v C++ (`TopTools_IndexedMapOfShape`), operace portu, tessellace rovnou do plochých polí.
- [ ] Vazby embind jen pro API portu: hodnoty ven jako `TypedArray` view do haldy WASM, kopírované do vlastních `ArrayBuffer` (kontrakt bufferů ze spec 06).
- [ ] Výjimky OCCT → kód chyby jádra (`KernelErrorCode`) v C++.
- [ ] Adaptér `kernel-occt` přepnout na nový modul, kontraktová sada musí projít beze změny.
- [ ] Únik paměti ([[Q054 Únik paměti v OCCT buildu|Q054]]): najít příčinu (C++, sanitizer / počítání `Standard_Transient`), opravit nebo obejít, a zavést paměťový test, který únik v adaptéru opravdu odhalí. Pokud únik zůstane: zvážit restart workeru jádra po překročení paměti (regen umí `'disconnected'`, [[Q049 Pád jádra během regenerace|Q049]]).
- [ ] Exportovat `stackSave` a `stackRestore` a obnovit ukazatel zásobníku po výjimce C++, která doletí do JS (A7 z [[Revize kódu 2026-10-14|revize kódu]], [[Q055 Pád WASM jádra|Q055]]). Dnes každá taková výjimka posune `__stack_pointer` o 32 B a po ~262 000 výjimkách nastane trap.
- [ ] Porovnání s `replicad-opencascadejs`: velikost WASM, čas startu, čas tessellace na větším modelu.
- [ ] Nové ADR, které nahradí [[0013-replicad-opencascadejs|ADR 0013]].

## Akceptační kritéria

- Kontraktová sada jádra projde s novým modulem beze změny testů.
- Build je reprodukovatelný jedním příkazem (Docker).
- Opakované `makeBox` + `tessellate` + `release` nezvětšuje haldu WASM (nebo je únik vysvětlený a ohraničený).

## Co se naučíš

Emscripten a embind z pohledu C++ vývojáře, návrh úzkého rozhraní mezi C++ a JS, správa paměti na hranici WASM. Prakticky si ověříš, že port dovolí vyměnit adaptér bez zásahu do zbytku aplikace.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
