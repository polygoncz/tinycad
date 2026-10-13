---
type: concept
aliases:
  - CadDocument
code: "CadDocument"
module: "document"
summary: "Kořenový objekt, který se ukládá: metadata + Part Studio."
related:
  - "[[Part Studio]]"
  - "[[Featura]]"
  - "[[Neměnná data]]"
tags:
  - pojem
created: 2026-10-12
updated: 2026-10-13
---
# Dokument

Kořenový objekt aplikace, který se ukládá a otevírá. Obsahuje metadata a [[Part Studio]]. Je to **recept**, ne geometrie – geometrie se vždy odvozuje [[Regenerace|regenerací]].

V kódu `CadDocument`, ne `Document` (kolize s DOM). Je to vnitřní třída modulu `document`, ven jde jen přes rozhraní ([[0011-programovani-proti-rozhranim|ADR 0011]]): čte se přes `DocumentReader`, mění jen handlery operací přes `DocumentWriter`, vzniká přes `createDocument`.

**V návrhu:** [[03-dokument]], [[0003-dokument-je-recept]]
**Souvisí:** [[Part Studio]], [[Featura]], [[Neměnná data]]
