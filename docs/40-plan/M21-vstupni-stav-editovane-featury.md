---
type: milestone
status: todo
order: 21
aliases:
  - M21
  - M21 Vstupní stav editované featury
modules:
  - regen
  - interaction
  - render
  - app
specs:
  - "[[07-regenerace]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
depends_on:
  - "[[M20-zpevneni-struktury]]"
started:
finished:
tags:
  - milnik
created: 2026-10-14
updated: 2026-10-14
---
# M21 – Vstupní stav editované featury

**Cíl:** dialog featury a skicář vybírají, zvýrazňují a počítají roviny nad stejným stavem, ve kterém [[Builder featury|builder]] vyhodnocuje reference (A1 z [[Revize kódu 2026-10-14|revize kódu]]).

> Hrubý plán – před zahájením rozhodnout [[Q075 Vstupní stav editované featury|Q075]] (varianta A, nebo B) a upřesnit úkoly.

**Specifikace:** [[07-regenerace]], [[10-interakce]], [[11-ui]]

**Navazuje na:** [[M20-zpevneni-struktury|M20]]. Pavel 2026-10-14: A1 až po zpevnění struktury, protože bude stavět na tabulce druhů referencí (A2).

## Úkoly (orientačně)

- [ ] Rozhodnout [[Q075 Vstupní stav editované featury|Q075]], nové ADR
- [ ] Picking a zvýraznění referenčních parametrů nad vstupním stavem editované featury, výsledek jako náhledová vrstva
- [ ] Rovina editované skici ze `SketchArtifact.plane`, ne z koncového stavu ([[Rozhodnutí noční rychloakce|R108]])
- [ ] Slučování sousedních kroků [[Transakce|transakce]] už v `applyStep`, aby „Zrušit“ po dlouhém tažení nepřehrávalo tisíce kroků

## Akceptační kritéria

- Klik na hranu u plochy zaoblení při editaci zaoblení neuloží jméno z výstupu téže featury.
- Vybrané hrany v dialogu zaoblení jsou zvýrazněné.
- Skica na ploše se otevře i po pozdější Transformaci a Booleanu, který těleso spotřebuje.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
