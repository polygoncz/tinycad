---
type: question
status: answered
area: "[[08-topologicke-pojmenovani]]"
decide_by: "[[M14-topologicke-pojmenovani]]"
proposal: "Použít všechny části + varování"
decision: "Jméno na víc ploch: použijí se všechny + varování featury; rovina skici a Po plochu vezmou první plochu + varování"
tags:
  - otazka
created: 2026-10-12
updated: 2026-10-14
---
# Q015 Rozdělená plocha a reference

**Oblast:** [[08-topologicke-pojmenovani]] · **Rozhodnout do:** [[M14-topologicke-pojmenovani]]

## Otázka

Jak se má chovat reference, když se plocha rozdělí a uživatel chtěl jen jednu část?

## Možnosti a návrh

Onshape to řeší dalším výběrem. My zatím použijeme všechny části a vydáme varování.

## Rozhodnutí

2026-10-14 (noční rychloakce, bez Pavla – [[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R96]] ⚠): **podle návrhu.** Rozdělená plocha předá jméno všem částem (`modified` 1 → n, [[08-topologicke-pojmenovani#Tabulka jmen a přenos]]); `BuildContext.resolveTopo` pro plochy vrátí všechny indexy a zavolá `ctx.warn` („Reference '<jméno>' matches <n> faces; all are used“), featura je žlutá, ne červená. U hran se víc nálezů použije bez varování (zaoblit obě části rozdělené hrany je obvykle chtěné).

Kde jde použít jen jedna plocha (rovina skici na ploše, konec vysunutí „Po plochu“), vezme se plocha s nejmenším indexem a varování zůstává. Index je v rámci jedné regenerace deterministický, mezi regeneracemi ne – proto varování. Zúžení výběru na jednu část (Onshape to řeší dalším výběrem) je mimo rozsah M14. Formát jmen v [[0018-format-topologickych-jmen|ADR 0018]].
