---
type: question
status: answered
area: "[[13-testovani]]"
decide_by: "[[M00-zaklad-projektu]]"
proposal: "Node 26, který je na Macu nainstalovaný"
decision: "Node 26"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q021 Verze Node

**Oblast:** [[13-testovani]] · **Rozhodnout do:** [[M00-zaklad-projektu]]

## Otázka

Milník M0 předepisoval Node 22, na Pavlově Macu je nainstalovaný Node 26.6 (npm 11.18). Kterou verzi zapsat do `.nvmrc` a `engines`?

## Možnosti a návrh

- **Node 22** – podle původního plánu. Je potřeba doinstalovat ji přes nvm/fnm. Projekt nikde jinde neběží, takže LTS stabilita nic nepřináší.
- **Node 26** – je k dispozici hned, nic navíc k instalaci. Na Node záleží jen u nástrojů a testů (Vitest, integrační testy OCCT WASM v Node).

Návrh: Node 26.

## Rozhodnutí

Node 26 (Pavel, 2026-10-13). `.nvmrc` = `26`, `engines.node` = `>=26`. Propsáno do [[M00-zaklad-projektu]].
