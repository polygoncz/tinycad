---
type: insight
status: seed
aliases:
  - Skrytá závislost na znalosti
  - Connascence of meaning
topics:
  - architektura
  - hranice modulů
sources:
  - https://connascence.io/
  - https://en.wikipedia.org/wiki/Connascence
tags:
  - poznatek
created: 2026-10-15
updated: 2026-10-15
---
# Čistý graf importů není čistá hranice

**Shrnutí:** Modul může záviset na jiném modulu, aniž by z něj cokoli importoval: stačí, že zná jeho obsah (jména, pořadí, literály). Nástroj na hranice (dependency-cruiser) takovou závislost nevidí, najde ji jen revize.

## Podrobnosti

- **Závislost na znalosti** (v literatuře *connascence of meaning / name*): dva moduly sdílí význam hodnoty, ne kód. Typicky literál `'sketch.constraint'` na dvou místech, pořadí skupin, která patří jinému modulu, nebo výčet, který obsahuje jména cizího modulu.
- **Proč je zrádná:** graf importů je čistý, `lint:deps` zelený, a přesto změna v jednom modulu (přejmenování skupiny, nové tlačítko) vyžaduje změnu ve druhém. Je to stejné „shotgun surgery“ jako u importu, jen bez varování.
- **Jak ji poznat při revizi:** hledat v modulu literály a výčty, které „patří“ jinému modulu (jména jeho akcí, nástrojů, skupin, id kreseb). Dobrá otázka: *kdyby druhý modul zmizel, dávala by tahle hodnota smysl?*
- **Jak ji odstranit:** obrátit tok znalosti. Modul, který obsah vlastní, ho **dodá** jako data (příspěvek, registr, konstanta ve vlastním datovém vstupním bodě) a obecný modul ho jen zpracuje. Kde to nejde, aspoň zapsat konvenci do specifikace jako kontrakt (např. „kresba, jejíž id není id artefaktu, se nedá odkázat“).

## Jak to využívá tinycad

V [[M20-zpevneni-struktury|M20]] po vyčlenění modulu `sketcher` ([[0024-modul-sketcher|ADR 0024]]) `interaction` neimportoval nic ze skicáře, ale `ToolbarModel` znal obsah jeho lišty: pořadí skupin `draw`, `constrain`, `finish`, tlačítka Hotovo a Zrušit, ikony vazeb a literál skupiny akcí. Našel to až `architecture-reviewer`. Oprava: `ToolbarModeContribution`, který dodá `sketcher` (`SKETCH_TOOLBAR`) a `app` předá modelu ([[10-interakce#Prezentační modely a `Observable`]]). Zbytek stejného druhu zůstal: `ToolDescriptor.group` je uzavřený výčet se skupinami skicáře.

Souvisí s [[Implicitní kontrakty první implementace]] (kontrakt splněný náhodou) a [[Revize proti ADR, nejen proti spec]].

## Zdroje

- Meilir Page-Jones: koncept *connascence*; přehled na https://connascence.io/
- https://en.wikipedia.org/wiki/Connascence
