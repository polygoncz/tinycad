---
type: insight
status: seed
aliases:
  - Kontrola kontraktů proti ADR
topics:
  - architektura
  - plánování
  - proces
sources:
  - https://adr.github.io/
  - https://www.atulgawande.com/book/the-checklist-manifesto/
tags:
  - poznatek
created: 2026-10-14
updated: 2026-10-14
---
# Kontrolní seznam plánu proti ADR

**Shrnutí:** Když se po několika revizích opakují stejné typy nálezů, nepatří jejich hledání do revize hotového kódu, ale do krátkého kontrolního seznamu, kterým projde už plán (kontrakty) před odevzdáním.

## Podrobnosti

- Revize po M11 i po M12 našly tytéž tři typy nálezů: **logika ve `.vue`** (zábrany editace, text stavu počítaný v komponentě), **široké závislosti** (celý port tam, kde stačí jeho část; generátor id, který modul nepoužívá) a **opsané seznamy v `ui`** (druhy vazeb vyjmenované v liště místo čtení z registru akcí).
- Všechny tři jsou vidět už v kontraktu: v signatuře `deps` (co modul dostává), v tom, kterou funkci plán přiřadí `ui`, a v tom, odkud komponenta bere seznam položek. Implementátor kontrakt splní doslova, takže chyba v plánu se jen zabetonuje (viz [[Revize proti ADR, nejen proti spec]]).
- Oprava po revizi je dražší: jeden úkol navíc (v M12 Ú16a), změna spec, testů i kódu, a znovu revize.
- Opakující se nález je signál pro proces, ne pro kód. Kontrolní seznam má být krátký (jen to, co se už opakovalo) a konkrétní (otázky s ano/ne), jinak ho nikdo neprojde.

## Jak to využívá tinycad

Plánovač milníku před odevzdáním Implementačního plánu projde každý kontrakt proti [[0010-prezentacni-model|ADR 0010]] a [[0011-programovani-proti-rozhranim|ADR 0011]]:

1. Má komponenta `.vue` jen vazby a volání příkazů? Každá podmínka „smí/nesmí“ a každý text odvozený ze stavu je v presenteru v `interaction`.
2. Dostává každý modul v `deps` jen to, co opravdu volá (`Pick<Port, …>`, žádné nepoužité `ids`)?
3. Bere `ui` seznamy položek (akce, nástroje, druhy) z registru nebo stavu, ne z vlastního opsaného pole?

Nálezy z revize, které do seznamu nepatří, se do něj přidají, až se zopakují. Revize `architecture-reviewer` na konci milníku zůstává ([[M12-skicar#Retrospektiva]]).

## Zdroje

- Architecture Decision Records (adr.github.io).
- Atul Gawande: The Checklist Manifesto.
