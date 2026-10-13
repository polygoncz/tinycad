---
type: concept
aliases:
  - Browser
code: "Browser"
module: "ui"
summary: "Plovoucí panel se stromem výsledku modelování: dokument, tělesa, později počátek a skici."
related:
  - "[[Těleso]]"
  - "[[Timeline]]"
  - "[[Výběr]]"
tags:
  - pojem
created: 2026-10-13
updated: 2026-10-13
---
# Prohlížeč

Plovoucí panel vlevo nad [[Viewport|viewportem]] (podle Fusion 360, kde se jmenuje *Browser*). Ukazuje strom *výsledku* modelování: dokument › Tělesa › jednotlivá [[Těleso|tělesa]] z poslední [[Regenerace|regenerace]]. Později přibudou Počátek (roviny a osy) a Skici. Klik na těleso ho přidá do [[Výběr|výběru]], oko přepíná viditelnost ([[Q071 Viditelnost těles|Q071]]). Liší se od [[Timeline]], která ukazuje historii featur. Potřebuje vlastní [[Prezentační model|prezentační model]] v `interaction`, který čte tělesa přes port, ne přímo z `regen`.

**V návrhu:** [[11-ui]]
**Souvisí:** [[Timeline]], [[Těleso]], [[Výběr]]
