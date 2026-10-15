---
type: question
status: open
area: "[[03-dokument]]"
decide_by: "[[M24-realisticke-zobrazeni]]"
proposal: "Pevná sada předvoleb (plast, hliník, ocel, mosaz, sklo, guma) jako BodyMeta.material; barva tělesa tónuje každou předvolbu; bez vlastních parametrů."
decision: ""
tags:
  - otazka
created: 2026-10-15
updated: 2026-10-15
---
# Q078 Sada materiálů těles

**Oblast:** [[03-dokument]], [[09-vykreslovani]] · **Rozhodnout do:** [[M24-realisticke-zobrazeni]]

## Otázka

V režimu Realistic ([[Styl zobrazení]]) se [[Těleso|těleso]] kreslí `MeshPhysicalMaterial` podle svého materiálu, který se ukládá v dokumentu vedle barvy (`BodyMeta.material`, operace `body.setMaterial`). Zbývá rozhodnout:

1. Jakou sadu materiálů nabídnout a jak ji v dokumentu reprezentovat?
2. Jak se materiál a barva tělesa ([[Q073 Průhlednost a barva těles|Q073]]) skládají dohromady?
3. Smí materiál být průhledný (sklo, `transmission`), když průhlednost těles Q073 odložila?

## Možnosti a návrh

**Reprezentace:**
1. **Pevná sada předvoleb** (`'plastic' | 'aluminium' | 'steel' | 'brass' | 'glass' | 'rubber'`), parametry (`metalness`, `roughness`, `clearcoat`, `transmission`) má jen `render`.
   - \+ Dokument nese jen identifikátor, validace je výčet. Nová předvolba = nová hodnota bez migrace.
   - − Uživatel neumí doladit drsnost.
2. **Parametry v dokumentu** (`{ metalness, roughness, … }`).
   - \+ Plná volnost.
   - − Dokument nese detaily rendereru a každá změna materiálového modelu znamená migraci.

**Barva × materiál:**
- a) Barva **tónuje** předvolbu (hliník s modrou barvou = eloxovaný hliník). Bez barvy má předvolba vlastní výchozí barvu.
- b) Materiál barvu přebíjí, barva platí jen mimo Realistic.

**Návrh:** 1 + a. Sklo ano, ale jen v Realistic (fyzikální `transmission`, ne `opacity`), takže nevzniká problém s řazením, kvůli kterému Q073 průhlednost odložila. Jestli sklo nakonec bude, potvrdí M24.

## Rozhodnutí

_(Až se rozhodne: vyplnit sem, nastavit `status: answered` a `decision`, rozhodnutí propsat do specifikace. Zásadní rozhodnutí → nové ADR.)_
