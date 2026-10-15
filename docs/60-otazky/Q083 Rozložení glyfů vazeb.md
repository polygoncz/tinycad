---
type: question
status: answered
area: "[[12-skicar]]"
decide_by: "[[M25-glyfy-vazeb]]"
proposal: "Glyfy u středu entity (bod: vpravo nahoře), v řadě kolmo od entity, rozložení jako čistá funkce v pixelech přepočítaná po změně kamery; vazba dvou entit má glyf u obou."
decision: "Jako Onshape: glyfy jen u vybraných a najetých entit, přepínač Zobrazit vazby ukáže všechny; poloha = kotva na entitě v modelu + skládání v pixelech; kreslí vrstva v ui nad pohledem jako kóty."
tags:
  - otazka
created: 2026-10-15
updated: 2026-10-15
---
# Q083 Rozložení glyfů vazeb

**Oblast:** [[12-skicar#Kresba a picking]], [[09-vykreslovani#Skici]] · **Rozhodnout do:** [[M25-glyfy-vazeb]]

## Otázka

Kde přesně se glyf vazby kreslí a kdo jeho polohu počítá? Glyfy mají konstantní velikost v pixelech, takže jejich vzájemné překrývání závisí na zoomu. Zároveň je chceme počítat mimo `render` (testovatelně v Node), protože `render` má dostávat hotová data ([[0017-modul-sketch-a-skicar|ADR 0017]]).

## Možnosti a návrh

- a) **Kotva v jednotkách modelu, odsazení v pixelech.** `interaction` spočítá pro každý glyf kotvu na entitě (střed úsečky, bod kružnice nahoře, bod) a pořadí v řadě; `render` je vyskládá od kotvy v pixelech kolmo od entity.
  - \+ Nezávisí na kameře, přepočet jen po změně skici. `render` dělá jen triviální posun.
  - − Při silném oddálení se glyfy různých entit mohou překrývat.
- b) **Plné rozložení s kolizemi v pixelech** v `interaction` po každé změně kamery.
  - \+ Žádné překryvy.
  - − Kamera by musela téct do `interaction`; dražší, víc stavu.
- c) **Jako Onshape: glyfy jen u vybraných / najetých entit.**
  - \+ Méně šumu.
  - − Méně přehledné; Pavel chce vidět vazby jako ve Fusionu.

**Návrh:** a). Překryvy při extrémním oddálení jsou přijatelné (Fusion se chová stejně); vazba dvou entit má glyf u obou a najetí na jeden zvýrazní oba.

## Rozhodnutí

Pavel 2026-10-15: **glyfy jen u vybraných entit** (styl Onshape), ne u všech jako ve Fusionu.

- Výchozí stav: glyfy vazeb, které se týkají vybraných entit a entity pod kurzorem. Najetí na glyf zvýrazní všechny entity vazby.
- Přepínač „Zobrazit vazby“ v panelu skici ukáže glyfy u všech entit (užitečné na kontrolu, výchozí vypnuto, neukládá se).
- Poloha: kotva na entitě v souřadnicích roviny počítaná v `interaction` (čistá funkce) + skládání v řadě kolmo od entity v pixelech (původní možnost a). Překryvy při silném oddálení jsou přijatelné.
- Kreslí je **vrstva v `ui` nad pohledem** jako kóty z M19.2 (SVG/HTML tlačítka), ne `render` – Pavel 2026-10-15 po zjištění, že kóty už tak fungují. Hover a klik řeší DOM, nový `PickKind` nevzniká.
- Propsáno do [[12-skicar#Glyfy vazeb (M25)]].
