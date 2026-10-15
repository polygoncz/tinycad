---
type: question
status: answered
area: "[[09-vykreslovani]]"
decide_by: "[[M23-postprocessing-a-ao]]"
proposal: "GTAOPass z three/addons za EffectComposer; zvýraznění, skici a manipulátory se kreslí až po AO; jeden přepínač ao, výchozí vypnutý."
decision: "GTAOPass za EffectComposer v jednom MSAA render targetu: model, AO na místě, interakce bez mazání hloubky, výstup. Scéna se dělí viditelností skupin. Jeden přepínač ao, výchozí vypnutý (ADR 0026)."
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

Pavel 2026-10-15 schválil návrh 1 + a + i s upřesněním, které vyšlo z API `GTAOPass` ve three 0.186. Podrobnosti a alternativy jsou v [[0026-viceprochodove-vykreslovani-ve-viewportu|ADR 0026]]:

- **Technika:** `GTAOPass` za `EffectComposer` (1).
- **Oddělení (a), upřesněné:**
  - Všechno se kreslí uvnitř composeru do jednoho MSAA render targetu: model → AO vynásobené na místě → interakce bez mazání hloubky → `OutputPass`. Dokreslení po composeru na plátno by nemělo hloubku modelu.
  - Scéna se nedělí přes `Object3D.layers`, ale přepnutím `visible` u kořenových skupin během průchodu. Vrstvy se nedědí a `Raycaster` by o objekty přišel.
- **Výchozí hodnota (i):** jeden přepínač `ao`, výchozí `false`, platí v Shaded bez průhlednosti a od M24 v Realistic.

Propsáno do [[09-vykreslovani#Víceprůchodové vykreslování (AO)]] a [[11-ui#Komponenty]].
