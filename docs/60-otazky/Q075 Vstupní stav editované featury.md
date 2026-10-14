---
type: question
status: open
area: "[[10-interakce]]"
decide_by: "[[M19.1-opravy-z-revize]]"
proposal: "ADR: dialog a skicář pickují a zvýrazňují nad vstupním stavem editované featury, náhled výsledku je samostatná vrstva"
decision: ""
tags:
  - otazka
created: 2026-10-14
updated: 2026-10-14
---
# Q075 Vstupní stav editované featury

**Oblast:** [[10-interakce]] · **Rozhodnout do:** [[M19.1-opravy-z-revize]]

## Otázka

Nad jakým stavem modelu má dialog featury a skicář vybírat, zvýrazňovat a počítat roviny? [[Revize kódu 2026-10-14]] (A1, C4) ukázala, že dnes jde o **koncový stav** včetně náhledu editované featury, kdežto [[Builder featury|builder]] vyhodnocuje reference ve **vstupu** featury (stav před ní).

Ověřeno v prohlížeči:
- **Zaoblení:**
  - Vybraná hrana je zaoblená, proto zmizí a není zvýrazněná.
  - Klik na hranu sousedící s plochou zaoblení uloží jméno z výstupu téže featury (`edge:…/face:fillet:…`) a featura spadne s `UNRESOLVED_REFERENCE`.
  - Prevence „neber jméno z vlastního výstupu“ by musela jméno rozebrat, což [[0018-format-topologickych-jmen|ADR 0018]] zakazuje.
- **Skica na ploše:**
  - Rovina se bere z koncového stavu (`planeOfRef(lastState, …)`). Pozdější Transformace ji posune.
  - Pozdější Boolean, který těleso spotřebuje, skicu vůbec neotevře ([[Rozhodnutí noční rychloakce|R108]]).

Týká se to každé featury, která mění tvar, na který sama odkazuje (shell, úkos, díra). Souvisí s generacemi z [[M19.1-opravy-z-revize|M19.1]] (D3).

## Možnosti a návrh

| Varianta | Pro | Proti |
|---|---|---|
| **A: vstupní stav pro výběr, náhled zvlášť.** Stav před featurou je v cache Regeneratoru (`entries[i-1].state`). `RegenSnapshot` při otevřeném dialogu nese i tělesa a jména vstupu editované featury, picking a zvýraznění referenčních parametrů jde nad nimi. Výsledek featury se kreslí jako náhledová vrstva (průhledně nebo jen hrany), jako v Onshape a Fusion. | správně z principu, opraví zaoblení i skicu na ploše najednou, nic se nerozebírá | víc práce: dva stavy v portu, náhledová vrstva v `render`, tessellace vstupu |
| B: regen označí jména, která featura vyrazila (`NameTable` s množinou „mintedBy“), a `interaction` taková jména pro vlastní parametry odmítne | malé, bez nové vrstvy | řeší jen samoreferenci, ne zmizelé zvýraznění ani rovinu skici |
| C: nechat a spoléhat na chybu a čipy (M19.1 D5, D6) | žádná práce | uživatel dál klikne „do náhledu“ a dostane chybu |

Návrh: **A jako nové ADR** před další featurou, která mění vlastní vstup. Rovinu editované skici brát ze `SketchArtifact.plane` jde udělat hned, protože se počítá ze vstupního stavu.

## Rozhodnutí

_(Až se rozhodne: vyplnit sem, nastavit `status: answered` a `decision`, rozhodnutí propsat do specifikace. Zásadní rozhodnutí → nové ADR.)_
