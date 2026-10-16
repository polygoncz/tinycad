---
type: milestone
status: todo
order: 31
aliases:
  - M31
  - M31 Nové kreslicí nástroje
modules:
  - sketch
  - solver-planegcs
  - sketcher
  - render
  - ui
specs:
  - "[[12-skicar]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
depends_on:
  - "[[M29-spliny]]"
started:
finished:
tags:
  - milnik
created: 2026-10-16
updated: 2026-10-16
---
# M31 – Nové kreslicí nástroje
**Cíl:** skicář umí obdélník středem a rohem, obdélník třemi body (natočený), samostatný bod, drážku (přímou středem i celkovou délkou, obloukovou), režim konstrukce pro nově kreslené entity a nekonečnou konstrukční přímku.

> Hrubý plán – před zahájením upřesnit (kontrakt ve spec 12). Sdílené typy jsou zafixované v [[12-skicar#Sdílené kontrakty série II]].

**Specifikace:** [[12-skicar#Data (`sketch`)]], [[12-skicar#Režim skicáře (sketcher)]], [[12-skicar#Rodiny nástrojů v liště]]

**Navazuje na:** [[M29-spliny|M29]]. Milník série *Rozšíření skicáře II* (M30–M37), viz [[12-skicar#Rozšíření skicáře II (M30–M37)]] a [[Roadmapa#Rozšíření skicáře II (M30–M37)]]. Stopa B; geometrii nemění, jen přidává entity a vazby, takže na [[M30-geometrie-skici-v-occt|M30]] nečeká.

## Rozsah

Pavel 2026-10-16: „Chtěl bych ještě dodělat do Sketch následující feature: obdélník zadaný středem a jedním krajním bodem, obdélník zadaný třemi body, možnost zadat bod, zadávat text, Construction Line, fillet a chamfer mezi dvěma hranami, trim, extend, split, offset, slot, mirror, linear a circular pattern.“

Upřesnění v sezení 2026-10-16:
- „Construction Line“ = **obojí**: přepínač režimu konstrukce (dokud je zapnutý, nové entity vznikají jako konstrukční; dnes jde jen přepnout už nakreslené) **a** nekonečná konstrukční přímka jako nová entita.
- „Možnost zadat bod“ = **obojí**: nástroj Bod (tady) a číselný vstup při kreslení ([[M32-ciselny-vstup|M32]]).
- Drážky: **přímá střed–střed, přímá celkovou délkou, oblouková**.

## Úkoly (orientačně)

- [ ] Konstrukce v `sketch/construct.ts`: obdélník ze středu a rohu (vazba `midpoint` nebo symetrie na úhlopříčku), obdélník ze tří bodů (rovnoběžnost a kolmost místo vodorovná/svislá), drážky (úsečky + oblouky s tečností a rovností).
- [ ] Nástroje: obdélníky do rodiny Obdélník, drážky do rodiny Drážka, nástroj Bod.
- [ ] Režim konstrukce: přepínač v liště a klávesa (Q jako Onshape); nástroje vytvářejí entity s `construction: true`.
- [ ] Nekonečná přímka: entita `SketchXLine` přes dva body, vždy konstrukční, kresba jako dlouhá úsečka, snapper a vazby podle kontraktu ([[12-skicar#Nekonečná přímka (M31, stopa B)]]).
- [ ] Spec 12, glyfy a snapper pro nové entity, e2e.

## Akceptační kritéria

- Každý nový nástroj vytvoří správné entity a vazby, degenerovaný vstup nic, Esc zruší.
- Obdélník a drážka po změně jedné kóty zůstanou obdélníkem a drážkou (vazby drží tvar).
- V režimu konstrukce kreslí všechny nástroje konstrukční entity; nekonečná přímka nevstupuje do oblastí.

## Co se naučíš

Jak tvar popsat vazbami místo souřadnic (obdélník = 4 úsečky + rovnoběžnost/kolmost), a jak entita bez konce (přímka) projde datovým modelem, kresbou a pickingem.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva
