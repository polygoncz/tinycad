---
type: insight
status: seed
aliases:
  - Výběr s rozhodčím při shodě
  - Two-stage picking
topics:
  - interakce
  - picking
sources:
  - https://en.wikipedia.org/wiki/Lexicographic_order
tags:
  - poznatek
created: 2026-10-15
updated: 2026-10-15
---
# Řazení kandidátů ve dvou stupních

**Shrnutí:** Když výběr pod kurzorem řadí kandidáty podle jedné metriky, prohraje to, na co uživatel míří. Funguje primární metrika „blízko kurzoru“ a druhá metrika jen jako rozhodčí mezi kandidáty, které jsou prakticky stejně blízko.

## Podrobnosti

- Při výběru „skrz“ (průhlednost, drátový model) je v toleranci několik hran za sebou. Pravidlo „vyhrává nejbližší ke kameře“ zní logicky, ale přední hrana o 4 px vedle pak přebije zadní hranu přesně pod kurzorem.
- Pravidlo jen „nejbližší kurzoru“ zase selže, když se hrany na obrazovce přesně kryjí (pohled kolmo na stěnu). Vyhraje ta, kterou algoritmus najde první, tedy náhodně.
- Řešení: kandidáti seřazení podle vzdálenosti od kurzoru, okno „překryvu“ (např. 1 px od nejlepšího) a teprve v něm rozhoduje hloubka. Je to lexikografické řazení s tolerancí na prvním klíči.
- Stejný vzor platí obecně pro snapping, hit-testing a výběr v seznamech podle více kritérií. Tolerance na prvním klíči je důležitá, protože na čistém float porovnání se druhý klíč skoro nikdy neuplatní.

## Jak to využívá tinycad

`Picker` při `xray` ([[09-vykreslovani#Picking a zvýraznění]]), rozhodnuto v [[Q080 Výběr hrany v režimu xray|Q080]] během [[M22-rezimy-zobrazeni|M22]]. Navazuje na [[Picking hran v pixelech]].

## Zdroje

- Wikipedia: Lexicographic order
