---
type: milestone
status: todo
order: 38
aliases:
  - M38
  - M38 Zmrazení domény a sdílené případy
modules:
  - document
  - ops
  - regen
  - kernel
  - sketch
  - features
specs:
  - "[[13-testovani]]"
  - "[[14-protokol]]"
depends_on:
  - "[[M37-text-ve-skice]]"
started:
finished:
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M38 – Zmrazení domény a sdílené případy

**Cíl:** TS doména se zmrazí a z jejích testů vzniknou sdílené testovací případy (JSON), proti kterým se bude ověřovat C++ jádro.

> Hrubý plán série nativního jádra (2026-10-17). Před zahájením upřesnit úkoly, kontrakt a Implementační plán.

**Specifikace:** [[13-testovani]], [[14-protokol]], [[0030-nativni-jadro-pres-grpc|ADR 0030]]

**Navazuje na:** [[M37-text-ve-skice]]

## Úkoly

- [ ] Vyhlásit zmrazení: od začátku milníku se `document`, `ops`, `regen`, `kernel`, `kernel-occt`, `features/*` a `persistence` mění jen kvůli chybám (pravidlo v [[Roadmapa#Nativní jádro (M38–M47)]]).
- [ ] Formát sdíleného případu (`test/shared-cases/<oblast>/<název>.json`): vstup, očekávaný výstup, tolerance. Krátký popis do [[13-testovani]].
- [ ] Exportér případů z dnešních testů: replay logů (operace → `toData`), transakce a undo, migrace featur, `validate` operací.
- [ ] Případy regenerace nad skutečným OCCT (WASM): dokument → statusy, tělesa (objem, obálka, počty ploch a hran, jména ploch a hran), kotvy.
- [ ] Případy kontraktové sady jádra a 2D geometrie skici (oblasti, průsečíky, segment, zaoblení, offset) s tolerancemi.
- [ ] Případy řešiče skici (vstupní data skici → vyřešené souřadnice) a odvozených entit (zrcadlení, pole, písmena textu).
- [ ] TS testy čtou tytéž soubory, takže případ nemůže zastarat (případ, který TS neprojde, shodí `npm run check`).

## Akceptační kritéria

- Sdílené případy pokrývají všechny typy operací, všechny featury, všechny metody `SketchGeometry` a řešič skici.
- TS sada je proti nim zelená a `npm run check` je spouští.

## Co se naučíš

Jak z existující sady testů udělat jazykově nezávislou specifikaci (golden tests) a jak volit tolerance u geometrie.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
