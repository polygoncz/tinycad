---
type: concept
aliases:
  - ReadModel
  - Model pro čtení
code: "ReadModel"
module: "server"
summary: "Neměnný snímek dokumentu, výsledku regenerace a stavu sezení, který klient po každé změně dostane od serveru a jen čte."
related:
  - "[[Sezení]]"
  - "[[Regenerace]]"
  - "[[Prezentační model]]"
  - "[[Rozpracované hodnoty dialogu]]"
tags:
  - pojem
created: 2026-10-17
updated: 2026-10-18
---
# Read model

Snímek všeho, co klient potřebuje zobrazit: featury a [[Rollback bar|rollback bar]], stavy a tělesa poslední [[Regenerace|regenerace]], skici, kotvy manipulátorů, `canUndo`/`canRedo`. Pojem pochází z CQRS: zápis jde přes operace, čtení přes zvláštní model pro čtení. Klient ho dostane celý v odpovědi na každou změnu a nahradí jím předchozí, jen sítě těles jdou podle verze obsahu ([[Q099 Read model po regeneraci|Q099]], [[Q100 Verze sítí v mezipaměti klienta|Q100]]). Liší se od [[Prezentační model|prezentačního modelu]]: read model je data ze serveru, prezentační model je stav UI odvozený z něj. Od [[M52-tenky-klient|M52]] je dokument klienta jen snímek read modelu (`createSnapshotDocument`); dokud server nepřijme poslední změnu dialogu, ukazuje dialog místo něj [[Rozpracované hodnoty dialogu|rozpracované hodnoty]].

**V návrhu:** [[14-protokol]]
**Souvisí:** [[Sezení]], [[Těleso]], [[Rozpracované hodnoty dialogu]]
