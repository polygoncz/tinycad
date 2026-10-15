---
type: question
status: answered
area: "[[09-vykreslovani]]"
decide_by: "[[M22-rezimy-zobrazeni]]"
proposal: "Při xray rozhoduje vzdálenost od kurzoru v px, hloubka jen mezi kandidáty do 1 px od nejlepšího; skici beze změny."
decision: "Nejblíž kurzoru, shoda do 1 px podle blízkosti ke kameře; entity skic si nechávají své pořadí."
tags:
  - otazka
created: 2026-10-15
updated: 2026-10-15
---
# Q080 Výběr hrany v režimu xray

**Oblast:** [[09-vykreslovani]] · **Rozhodnout do:** [[M22-rezimy-zobrazeni]]

## Otázka

V režimech [[Styl zobrazení|stylu zobrazení]] s `xray` (Wireframe, Hidden lines visible, průhledný Shaded) picking nekontroluje zákryt, takže v toleranci 6 px může být víc hran, přední i zadní. Spec 09 původně říkala: „z kandidátů v toleranci vyhrává nejbližší ke kameře“. Implementace úkolu 4 to dodržela a test to ověřuje: přední hrana 4 px od kurzoru vyhraje nad zadní hranou 1 px od kurzoru.

1. Která hrana má vyhrát, když je v toleranci víc kandidátů?
2. Má stejné pravidlo platit i pro entity skic?

## Možnosti a návrh

1. **Nejblíž ke kameře z celé tolerance** (původní spec). Jednoduché, ale zadní hranu, na kterou uživatel míří skoro přesně, přebije přední hrana o kus vedle. Ve Wireframe tak jde zadní hrana vybrat špatně.
2. **Jen nejblíž kurzoru.** Přirozené pro míření, ale u hran, které se na obrazovce přesně kryjí (pohled kolmo na stěnu kvádru), vyhraje ta, kterou algoritmus najde první, tedy náhodně přední nebo zadní.
3. **Nejblíž kurzoru, shoda podle hloubky** (návrh). Rozhoduje vzdálenost v px. Kandidáti do 1 px od nejlepšího se berou jako překrývající se a mezi nimi vyhraje ten blíž ke kameře. Spojuje výhody obou: míření funguje a u překryvu vyhraje to, co je vidět vepředu.

Pro skici návrh **beze změny**: mají vlastní pořadí (bod před křivkou, pak px, mezi skicami `betterSketchHit`) a xray jim jen vypne zákryt tělesy. Entity jedné skice leží v rovině, takže hloubka mezi nimi nerozhoduje.

## Rozhodnutí

Pavel 2026-10-15: možnost 3. Při xray vyhrává hrana nejblíž kurzoru v px, kandidáti do 1 px od nejlepšího se rozhodnou podle blízkosti ke kameře. Entity skic si nechávají své pořadí, xray jim jen vypíná kontrolu zákrytu. Propsáno do [[09-vykreslovani#Picking a zvýraznění]].
