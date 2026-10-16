---
type: milestone
status: todo
order: 30
aliases:
  - M30
  - M30 Geometrie skici v OCCT
modules:
  - kernel
  - kernel-occt
  - sketch
  - features
  - regen
  - interaction
  - sketcher
  - app
specs:
  - "[[12-skicar]]"
  - "[[06-geometricke-jadro]]"
  - "[[07-regenerace]]"
  - "[[10-interakce]]"
depends_on:
  - "[[M29-spliny]]"
started:
finished:
tags:
  - milnik
created: 2026-10-16
updated: 2026-10-16
---
# M30 – Geometrie skici v OCCT
**Cíl:** oblasti, křížení a průsečíky křivek skici počítá jádro OCCT místo TypeScriptu ([[0028-geometrie-skici-v-jadre|ADR 0028]]). Uživatel nic nového nevidí; skici, oblasti, vysunutí a jména ploch fungují stejně, jen nad jednou geometrií. Je to základ pro trim, zaoblení a offset.

> Hrubý plán – před zahájením upřesnit (kontrakt portu, [[Q092 Hranice geometrie skici v TS a v OCCT|Q092]]).

**Specifikace:** [[12-skicar#Oblasti (profily)]], [[06-geometricke-jadro]], [[07-regenerace#Builder featury]], [[10-interakce#Kresba skici]]

**Navazuje na:** [[M29-spliny|M29]]. Milník série *Rozšíření skicáře II* (M30–M37), viz [[12-skicar#Rozšíření skicáře II (M30–M37)]] a [[Roadmapa#Rozšíření skicáře II (M30–M37)]]. První v stopě A, protože na něm stojí [[M33-trim-extend-split|M33]], [[M34-zaobleni-a-srazeni-ve-skice|M34]], [[M35-offset|M35]] a [[M37-text-ve-skice|M37]].

## Rozsah

Pavel 2026-10-16: „Chtěl bych ještě dodělat do Sketch následující feature: obdélník zadaný středem a jedním krajním bodem, obdélník zadaný třemi body, možnost zadat bod, zadávat text, Construction Line, fillet a chamfer mezi dvěma hranami, trim, extend, split, offset, slot, mirror, linear a circular pattern.“

Pavel v [[Q088 Geometrie skici v TypeScriptu nebo v OCCT#Znovuotevření 2026-10-16|Q088]] zvolil přesun **celé** geometrie skici do OCCT, ne jen nových operací.

## Úkoly (orientačně)

- [ ] Rozhodnout [[Q092 Hranice geometrie skici v TS a v OCCT|Q092]] a dopsat kontrakt portu do spec 06 a 12.
- [ ] Port `kernel`: oblasti skici (vstup `Curve2[]` s id, výstup oblasti se jmény, plochami a příznakem křížení), průsečíky dvou křivek; `FakeKernel` a kontraktové testy.
- [ ] `kernel-occt`: oblasti přes `BOPAlgo`/`BRepAlgoAPI` (dělení hran v průsečících, sestavení stěn), průsečíky přes `Geom2dAPI_InterCurveCurve`; jména oblastí z id hran.
- [ ] Builder skici bere oblasti z jádra; artefakt skici nese obrysy oblastí pro kresbu.
- [ ] `interaction`/`sketcher`: vyplnění a picking oblastí z artefaktu místo `computeRegions`.
- [ ] `sketch/regions.ts` jako orákulum testů, nebo do archivu (Q092).
- [ ] Spec 12 a 06 podle skutečnosti; dodatek k [[0017-modul-sketch-a-skicar|ADR 0017]] odkazem na ADR 0028.

## Akceptační kritéria

- Všechny dosavadní testy oblastí (jména, díry, křížení, spliny) projdou nad jádrem.
- Dokumenty z předchozích verzí dají stejné oblasti a stejná topologická jména ploch.
- E2e: skica s otvorem a splinem → vysunutí funguje jako dřív.

## Co se naučíš

Jak přesunout výpočet za port bez změny chování (kontraktové testy jako záchranná síť) a jak v OCCT z 2D hran postavit stěny s dírami, včetně přenesení jmen přes historii operace.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva
