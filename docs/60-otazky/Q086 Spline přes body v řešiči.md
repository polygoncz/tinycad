---
type: question
status: open
area: "[[12-skicar]]"
decide_by: "[[M29-spliny]]"
proposal: "Jedna entita bspline s řídicími body jako body skici; fit-point spline navíc uloží fit body a parametry uzlů, v řešiči point_on_bspline na pevných parametrech; řídicí body fit-splinu se neukazují a netáhnou. Bez racionálních vah."
decision: ""
tags:
  - otazka
created: 2026-10-15
updated: 2026-10-15
---
# Q086 Spline přes body v řešiči

**Oblast:** [[12-skicar#Řešič vazeb]], [[06-geometricke-jadro]] · **Rozhodnout do:** [[M29-spliny]]

## Otázka

[[M29-spliny|M29]] přidá kubický B-spline se dvěma nástroji: přes řídicí body (NURBS) a přes body, kterými křivka prochází (fit point). Planegcs zná jen spline daný řídicími body (`bspline`) a vazby `point_on_bspline`, `bspline_control_point`, `bspline_knot` – interpolaci bodů neumí. Zbývá rozhodnout:

1. Jak v datech a v řešiči držet **fit-point spline**, aby po tažení fit bodu křivka dál procházela všemi fit body?
2. Co se stane, když uživatel u fit-point splinu táhne **řídicí bod** (jestli ho vůbec vidí)?
3. **Racionální váhy** (pravé NURBS) ano, nebo jen polynomiální B-spline?

## Možnosti a návrh

**1. Fit-point spline:**
- a) **Řídicí body jako skryté proměnné řešiče + `point_on_bspline` na pevných parametrech** (parametr fit bodu z délky tětiv při vytvoření, uložený v datech). Řešič pak hýbe řídicími body tak, aby křivka procházela fit body.
  - \+ Jedna entita pro oba nástroje, řešič všechno drží konzistentní, vazby (tečnost na koncích) fungují.
  - − Řídicích bodů je víc než stupňů volnosti z fit bodů; bez dalších podmínek (koncové tečny) je systém neurčený a křivka může „plavat“.
- b) **Interpolace mimo řešič:** fit body jsou body skici, řídicí body se dopočítají přímou interpolací (lineární soustava) po každém řešení.
  - \+ Jednoznačná křivka, jednoduché.
  - − Vazby na samotnou křivku (tečná úsečka) řešič nevidí.
- c) Fit-point spline jen jako nástroj: po vytvoření se z něj stane spline přes řídicí body.
  - \+ Nejjednodušší.
  - − Fit body se ztratí, Pavel ale chce spline přes body jako plnohodnotnou křivku.

**Návrh:** a) s pevnými parametry a přirozenými koncovými podmínkami (druhá derivace 0 na koncích) jako dalšími vazbami, aby byl systém určený.

**2. Řídicí body fit-splinu:** u návrhu a) je nevidí a netáhne (tah je mění jen přes fit body); kdo je chce, převede spline na řídicí (akce *Převést na NURBS*, mimo rozsah M29).

**3. Váhy:** jen polynomiální B-spline (váhy 1). Planegcs váhy sice má, ale bez nástroje pro úpravu vah nejsou k ničemu a kuželosečky přes NURBS nepotřebujeme (kružnice a oblouky máme zvlášť).

## Rozhodnutí

_(Až se rozhodne: vyplnit sem, nastavit `status: answered` a `decision`, rozhodnutí propsat do specifikace. Zásadní rozhodnutí → nové ADR.)_
