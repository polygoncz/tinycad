---
type: question
status: open
area: "[[09-vykreslovani]]"
decide_by: "[[M23-postprocessing-a-ao]]"
proposal: "GTAOPass z three/addons za EffectComposer; zvýraznění, skici a manipulátory se kreslí až po AO; jeden přepínač ao, výchozí vypnutý."
decision: ""
tags:
  - otazka
created: 2026-10-15
updated: 2026-10-15
---
# Q077 Technika AO

**Oblast:** [[09-vykreslovani]] · **Rozhodnout do:** [[M23-postprocessing-a-ao]]

## Otázka

[[Styl zobrazení]] má v M23 dostat ambient occlusion (AO) v režimech Shaded (neprůhledný) a Realistic. Zbývá rozhodnout tři věci:

1. **Technika:** kterou implementaci AO použít?
2. **Co AO nesmí ztmavit:** zvýraznění, skici, overlay, manipulátory a mřížka nejsou geometrie modelu. Jak je od průchodu AO oddělit?
3. **Výchozí hodnota:** jeden přepínač `ao` pro oba režimy, nebo výchozí hodnota podle režimu (v Realistic zapnuté)?

## Možnosti a návrh

**Technika:**
1. **`GTAOPass` z `three/addons`** (ground truth AO, v Three.js od r160 a novější než SAO): kvalitní výsledek, odšumění v ceně, bez nové závislosti.
   - \+ Žádný nový balík, stejná verze jako `three`.
   - − Potřebuje vlastní průchod normál a hloubky (další render scény).
2. **`SAOPass`** (scalable AO): starší, jednodušší.
   - − Viditelný šum a halo kolem hran, ladění parametrů je pracné.
3. **Knihovna `n8ao`**: rychlá a pěkná, ale je to nová závislost mimo `three` (ADR).

**Oddělení:**
- a) **Dva průchody přes vrstvy (`Object3D.layers`):** composer kreslí jen vrstvu modelu (tělesa), zbytek scény se dokreslí běžným `renderer.render` po composeru se zachovanou hloubkou.
- b) **Dvě scény:** model a „interakce“ zvlášť. Čistší oddělení, ale mění vlastnictví objektů ve viewportu.

**Výchozí hodnota:**
- i) Jeden přepínač `ao`, výchozí `false`, platný v Shaded i Realistic. Kdo chce AO v Realistic, zapne si ho jednou. `DisplayStyle` zůstane plochý.
- ii) Výchozí hodnota podle režimu (Shaded vypnuto, Realistic zapnuto). Odpovídá to původní představě ze sezení 2026-10-15, ale `DisplayStyle` by potřeboval dvě pole (`aoShaded`, `aoRealistic`) nebo „nenastaveno“.

**Návrh:** 1 + a + i. Bez nové závislosti a s nejmenším zásahem do vlastnictví objektů. Rozhodnutí o víceprůchodovém vykreslování se zapíše jako ADR na začátku [[M23-postprocessing-a-ao|M23]].

## Rozhodnutí

_(Až se rozhodne: vyplnit sem, nastavit `status: answered` a `decision`, rozhodnutí propsat do specifikace. Zásadní rozhodnutí → nové ADR.)_
