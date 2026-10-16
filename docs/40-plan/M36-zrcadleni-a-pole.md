---
type: milestone
status: todo
order: 36
aliases:
  - M36
  - M36 Zrcadlení a pole
modules:
  - sketch
  - solver-planegcs
  - sketcher
  - render
  - ui
specs:
  - "[[12-skicar]]"
depends_on:
  - "[[M29-spliny]]"
started:
finished:
tags:
  - milnik
created: 2026-10-16
updated: 2026-10-16
---
# M36 – Zrcadlení a pole
**Cíl:** zrcadlení podle osy, lineární a kruhové pole entit skici jako **parametrická entita**: počet, rozteč a úhel jdou změnit i po vytvoření, přímo přes vynesené kóty ve viewportu.

> Hrubý plán – před zahájením rozhodnout [[Q089 Parametrické zrcadlení a pole ve skice|Q089]] a upřesnit.

**Specifikace:** [[12-skicar#Data (`sketch`)]], [[12-skicar#Řešič vazeb]], [[12-skicar#Kóty (M28)]]

**Navazuje na:** [[M29-spliny|M29]]. Milník série *Rozšíření skicáře II* (M30–M37), viz [[12-skicar#Rozšíření skicáře II (M30–M37)]] a [[Roadmapa#Rozšíření skicáře II (M30–M37)]]. Stopa C; geometrii nemění, na [[M30-geometrie-skici-v-occt|M30]] nečeká.

## Rozsah

Pavel 2026-10-16: „Chtěl bych ještě dodělat do Sketch následující feature: obdélník zadaný středem a jedním krajním bodem, obdélník zadaný třemi body, možnost zadat bod, zadávat text, Construction Line, fillet a chamfer mezi dvěma hranami, trim, extend, split, offset, slot, mirror, linear a circular pattern.“

Upřesnění v sezení 2026-10-16: zrcadlení a pole jako **parametrická entita**, „plus by tam bylo dobré mít i vynesené kóty podobně jako v Onshape nebo Fusion“.

## Úkoly (orientačně)

- [ ] Rozhodnout [[Q089 Parametrické zrcadlení a pole ve skice|Q089]] (identita kopií, vazby na kopie, řešič, vynesené kóty); prototyp v planegcs.
- [ ] Data: entita zrcadlení a pole, kontrola dat, odvození kopií; vazba symetrie.
- [ ] Nástroje Zrcadlit, Lineární pole, Kruhové pole; vynesené kóty počtu, rozteče a úhlu.
- [ ] Kopie v kresbě, oblastech a snapperu; mazání originálu a pole.
- [ ] Spec 12, e2e.

## Akceptační kritéria

- Změna počtu nebo rozteče přes kótu ve viewportu přestaví kopie; změna originálu se propíše do kopií.
- Oblasti z kopií mají stabilní jména (vysunutí přežije změnu rozteče).

## Co se naučíš

Odvozená geometrie v parametrickém modelu: kdy data nesou výsledek a kdy jen recept, a co to dělá s identitou entit.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva
