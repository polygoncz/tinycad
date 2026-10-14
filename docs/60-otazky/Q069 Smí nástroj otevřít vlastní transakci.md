---
type: question
status: answered
area: "[[10-interakce]]"
decide_by: "[[M13-extrude-revolve]]"
proposal: "Zúžit ToolContext.ops na dispatch; transakce jen přes FeatureEditor"
decision: "Varianta 1: ToolContext.ops = Pick<OperationDispatcher, 'dispatch' | 'inTransaction'>; transakce jen přes FeatureEditor a SketchEditor (M13, R78)"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-14
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

Rozhodnuto 2026-10-14 při plánování [[M13-extrude-revolve|M13]] (noční rychloakce, [[Rozhodnutí noční rychloakce#M13 – Extrude a Revolve|R78]]): **varianta 1**. `ToolContext.ops` je `Pick<OperationDispatcher, 'dispatch' | 'inTransaction'>`; vícekrokové změny jdou jen přes `FeatureEditor` (dialog) a `SketchEditor` (skicář), které transakci otevírají přes `FeatureEditor`.

Proč:
- Žádný nástroj transakci nepotřebuje: nástroje pluginů jen otevírají dialog, skicář má vlastní editor a první tažný nástroj (interaktivní kvádr) byl z M13 vypuštěn (R79).
- Jedno místo, které drží transakci, vylučuje souběh nástroje s dialogem a nemusí se hlídat na dvou místech.
- Rozšíření rozhraní je později zpětně kompatibilní (stávající nástroje dál fungují), zúžení by rozbilo nástroje, které by `begin` mezitím začaly používat.

Kdyby přišel nástroj, který mění víc featur najednou (přesun featur tažením), dostane úzkou službu v `interaction` (např. `FeatureTreeModel.move`), ne obecné `begin`. Propsáno do [[10-interakce#Nástroje]], úkol Ú3 v [[M13-extrude-revolve#Implementační plán]].
