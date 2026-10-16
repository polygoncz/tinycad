---
type: question
status: answered
area: "[[12-skicar]]"
decide_by: "[[M32-ciselny-vstup]]"
proposal: "Fusion: pole u kurzoru, Tab zamkne, kóta z každé zadané hodnoty"
decision: "Fusion – pole u kurzoru, Tab přepíná a zamyká, každá zadaná hodnota = kóta; souřadnice X, Y jen prvního bodu bez kót; hlavní nástroje; jen čísla (mm, °)"
tags:
  - otazka
created: 2026-10-16
updated: 2026-10-16
---
# Q090 Číselný vstup při kreslení

**Oblast:** [[12-skicar#Režim skicáře (sketcher)]], [[10-interakce]], [[11-ui]] · **Rozhodnout do:** [[M32-ciselny-vstup]]

## Otázka

Pavel 2026-10-16 chce „možnost zadat bod“ – nástroj Bod i číselný vstup při kreslení. Jak má číselný vstup vypadat?

- **Fusion:** u kurzoru pole délky a úhlu, Tab přepíná, zadaná hodnota se zamkne a vznikne z ní kóta.
- **Onshape:** píše se rovnou do kóty, která vznikne po kliknutí.
- **Souřadnice:** zadání absolutní polohy bodu (x, y) – kde, a vzniká z ní kóta k počátku?

Dále: vytváří zadaná hodnota kótu (vazbu) automaticky? Které nástroje vstup podporují (úsečka, obdélník, kružnice, oblouk, drážka, bod)? Výrazy a jednotky ([[Q003 Proměnné a výrazy v parametrech|Q003]])?

## Možnosti a návrh

1. **Styl Fusion** (návrh): u kurzoru pole podle nástroje (úsečka délka + úhel, obdélník šířka + výška, kružnice průměr…); psaní čísla jde do aktivního pole, Tab přepne pole a zamkne hodnotu (myš pak určuje jen zbytek), Enter potvrdí bod. Myš a klávesnice se kombinují.
2. **Styl Onshape:** kreslí se myší, po kliku se otevře pole vzniklé kóty. Jednodušší, ale nejde zamknout délku a směr mířit myší (akceptační kritérium M32).

Kóty: každá zadaná hodnota → kóta z [[M28-koty|M28]] (návrh), nebo jen geometrie. Souřadnice: pole X, Y před prvním bodem bez kót (návrh), s kótami k počátku, nebo vůbec. Nástroje: hlavní (návrh), nebo všechny. Výrazy a jednotky zůstávají na [[Q003 Proměnné a výrazy v parametrech|Q003]].

## Rozhodnutí

Pavel 2026-10-16 (stopa B, při práci na [[M31-nove-kreslici-nastroje|M31]]):
- **Styl Fusion:** pole u kurzoru, psaní čísla do aktivního pole, Tab přepíná a zamyká hodnotu, Enter potvrdí.
- **Každá zadaná hodnota = kóta** (vazba z M28); hodnoty jen naměřené myší kótu nedostanou.
- **Souřadnice:** pole X, Y pro první bod nástroje (a pro nástroj Bod), bod se jen umístí, **bez kót** k počátku.
- **Nástroje:** úsečka, obdélníky (rohy, středem, 3 body), kružnice středem, oblouk středem, drážky (3 druhy), bod, přímka. Bez splinů, 2/3bodových a tečných kružnic a oblouků.
- Jen čísla v mm a stupních; výrazy a jednotky dál [[Q003 Proměnné a výrazy v parametrech|Q003]].
