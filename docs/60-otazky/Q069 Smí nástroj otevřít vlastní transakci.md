---
type: question
status: open
area: "[[10-interakce]]"
decide_by: "[[M13-extrude-revolve]]"
proposal: "Zúžit ToolContext.ops na dispatch; transakce jen přes FeatureEditor"
decision: ""
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q069 Smí nástroj otevřít vlastní transakci

**Oblast:** [[10-interakce]] · **Rozhodnout do:** [[M13-extrude-revolve]]

## Otázka

`ToolContext.ops` je celý `OperationDispatcher`, takže [[Nástroj|nástroj]] může zavolat `begin()` a otevřít vlastní [[Transakce|transakci]] vedle `FeatureEditor`. Je to žádoucí (např. tažení, které mění víc featur), nebo má nástroj měnit dokument jen přes `dispatch` a dialog featury? Nález `architecture-reviewer` na konci [[M09-interakce]].

## Možnosti a návrh

1. **Zúžit na `dispatch`** – `ToolContext.ops: Pick<OperationDispatcher, 'dispatch' | 'inTransaction'>`; vícekrokové změny jen přes `FeatureEditSession`.
   - + jediné místo, které drží transakci; nemůže vzniknout souběh s dialogem.
   - − nástroj, který potřebuje transakci mimo featuru (např. přesun několika featur tažením), ji nemá.
2. **Nechat celý dispečer** – nástroj si transakci řídí sám, `FeatureEditor` i nástroj hlídá `inTransaction`.
   - + volnost pro budoucí nástroje. − dvě místa, která otevírají transakce.

Návrh: **1**, rozhodnout s prvním tažným nástrojem v [[M13-extrude-revolve]].

## Rozhodnutí

_(Až se rozhodne: vyplnit sem, nastavit `status: answered` a `decision`, rozhodnutí propsat do [[10-interakce]]. Zásadní rozhodnutí → nové ADR.)_
