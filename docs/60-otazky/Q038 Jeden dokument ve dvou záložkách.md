---
type: question
status: answered
area: "[[05-persistence]]"
decide_by: "[[M10-ui]]"
proposal: "Web Locks: dokument smí mít otevřený jen jedna záložka, druhá ho otevře jen pro čtení"
decision: "Web Locks na dokument v app; záložka bez zámku otevře dokument jen pro čtení."
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q038 Jeden dokument ve dvou záložkách

**Oblast:** [[05-persistence]] · **Rozhodnout do:** [[M10-ui]]

## Otázka

Když má uživatel stejný dokument otevřený ve dvou záložkách, obě mají vlastní [[Operační log|log]] v paměti a obě zapisují `seq` od stejného `lastSeq`. Kontrakt `appendEntries` záznam se `seq ≤ lastSeq` tiše přepíše (kvůli idempotentnímu retry), takže druhá záložka přepíše záznamy první a uložený log i [[Snapshot|snapshoty]] se rozejdou. Jak tomu zabránit?

## Možnosti a návrh

1. **Zámek na dokument (Web Locks API, `navigator.locks`).** Záložka, která zámek nedostane, otevře dokument jen pro čtení, případně s hláškou „otevřeno jinde“.
   - \+ Jednoduché, standardní, zámek se uvolní i při pádu záložky.
   - − Nejde pracovat na jednom dokumentu ve dvou oknech.
2. **Store odmítne přepis s jiným obsahem** (nový kód `'conflict'`): přepis je povolený jen pro shodný záznam (retry).
   - \+ Ochrana dat i bez UI, dá se otestovat kontraktovou sadou.
   - − Záložka, která prohraje, musí umět dokument znovu načíst. Porovnání obsahu stojí čtení navíc.
3. **Synchronizace záložek (`BroadcastChannel`)**, živé sdílení logu.
   - \+ Obě okna aktuální.
   - − Je to v malém kolaborace, mimo rozsah výukového projektu.

Návrh: **1** jako hlavní mechanismus (v `app`), a možná **2** jako pojistka v kontraktu portu.

## Rozhodnutí

2026-10-13 (Pavel): **možnost 1 – Web Locks.** `app` při otevření dokumentu požádá o `navigator.locks` se jménem podle id dokumentu. Záložka, která zámek nedostane, otevře dokument jen pro čtení s hláškou „otevřeno v jiné záložce“. Pojistka `'conflict'` ve store se zatím nedělá. Propsáno do [[11-ui]] a [[05-persistence]].
