---
type: question
status: open
area: "[[12-skicar]]"
decide_by: "[[M26-snapper-a-auto-vazby]]"
proposal: "Vzdálenostní prahy v pixelech (snap 6 px jako dnes), úhlové ve stupních (3° jako dnes); pevné pořadí priorit bod > střed > křivka > zarovnání > mřížka; více vazeb najednou dovoleno, jen jedna na dvojici entit."
decision: ""
tags:
  - otazka
created: 2026-10-15
updated: 2026-10-15
---
# Q084 Inference automatických vazeb

**Oblast:** [[12-skicar#Režim skicáře (sketcher)]], [[10-interakce#Nástroje a akce skicáře]] · **Rozhodnout do:** [[M26-snapper-a-auto-vazby]]

## Otázka

Snapper v [[M26-snapper-a-auto-vazby|M26]] má odvodit z polohy kurzoru přichycení i vazby (coincident, bod na křivce, střed, zarovnání bodů, kolmo, rovnoběžně, tečně, stejná délka). Zbývá rozhodnout:

1. **Prahy:** v pixelech obrazovky, nebo v jednotkách modelu? Úhly ve stupních?
2. **Priorita** při více kandidátech (kurzor je u koncového bodu i na vodítku zarovnání).
3. **Kolik vazeb** smí jeden klik vytvořit (např. bod na křivce + zarovnání + kolmo).
4. **Stejná délka / poloměr:** s čím se porovnává – jen s navazující křivkou, nebo s libovolnou ve skice? Jaká tolerance?

## Možnosti a návrh

- **Prahy:** a) pixely pro vzdálenosti, stupně pro úhly (dnešní snap 6 px a 3°); b) vše v modelu. **Návrh a)** – chování nezávisí na zoomu, tak to dělá Fusion i Onshape.
- **Priorita:** pevné pořadí bod (konec, střed kružnice, počátek) > střed úsečky > bod na křivce > průsečík vodítek zarovnání > jedno vodítko > mřížka. Úhlové inference (kolmo, rovnoběžně, vodorovně) se vyhodnocují až po poloze bodu a jen nad úsečkou, která vzniká.
- **Počet vazeb:** jeden klik smí vytvořit víc vazeb, ale na jednu dvojici entit nejvýš jednu; všechny se před zápisem ověří řešičem a redundantní/konfliktní se zahodí.
- **Stejná délka:** a) jen s navazující křivkou (předchozí úsečka polyline, sousední kružnice pod kurzorem) s tolerancí 2 % ; b) s libovolnou křivkou skici. **Návrh a)** – b) by na hustší skice vytvářelo nečekané vazby.

## Rozhodnutí

_(Až se rozhodne: vyplnit sem, nastavit `status: answered` a `decision`, rozhodnutí propsat do specifikace. Zásadní rozhodnutí → nové ADR.)_
