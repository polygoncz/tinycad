---
type: question
status: open
area: "[[10-interakce]]"
decide_by: "[[M21-vstupni-stav-editovane-featury]]"
proposal: "planes přestane být focusable, dokud ho nic nebere; topo z Prohlížeče nebrat (Prohlížeč hrany a plochy nemá)"
decision: ""
tags:
  - otazka
created: 2026-10-14
updated: 2026-10-14
---
# Q076 Rovina a hrany z Prohlížeče do referenčního parametru

**Oblast:** [[10-interakce]] · **Rozhodnout do:** [[M21-vstupni-stav-editovane-featury]]

## Otázka

Tabulka druhů referencí z [[M20-zpevneni-struktury|M20]] (A2, [[10-interakce#Nástroje]]) zachovala dnešní chování a tím ukázala dvě mezery:

- Parametr `planes` (rovina skici) jde v dialogu fokusovat, ale klik do viewportu nic nepřidá (`pickFilter` je prázdný) a [[Prohlížeč]] jeho řádky nebere. Uživatel klikne do pole, a pak se nic nestane.
- Prohlížeč nebere parametr `topo` (hrany a plochy pro zaoblení a zkosení). Prohlížeč ale řádky hran ani ploch nemá, takže jde spíš o konzistenci než o chybu.

Je tu i teoretický případ: hover nad oblastí editované skici ji zvýrazní, ale klik ji nevezme.

## Možnosti a návrh

| Varianta | Pro | Proti |
|---|---|---|
| **A: `planes` není `focusable`**, dokud ho nic nebere. Rovina skici se volí jen při vytvoření skici. | žádné mrtvé pole, jedna změna v tabulce | rovinu existující skici nejde v dialogu změnit |
| B: `planes` pickuje roviny počátku a rovinné plochy, Prohlížeč bere roviny | změna roviny skici jako v Onshape | nový `pickFilter` a převod zásahu; souvisí se vstupním stavem ([[Q075 Vstupní stav editované featury\|Q075]]) |

Návrh: A hned (jedna hodnota v tabulce), B případně v [[M21-vstupni-stav-editovane-featury|M21]] spolu s Q075, protože rovinu je potřeba brát ze vstupního stavu. `topo` z Prohlížeče nebrat.

## Rozhodnutí

_(Až se rozhodne: vyplnit sem, nastavit `status: answered` a `decision`, rozhodnutí propsat do specifikace. Zásadní rozhodnutí → nové ADR.)_
