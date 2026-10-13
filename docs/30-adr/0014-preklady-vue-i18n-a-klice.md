---
type: adr
status: accepted
number: 14
aliases:
  - ADR 0014
  - Překlady – vue-i18n a klíče v doméně
date: 2026-10-13
related:
  - "[[11-ui]]"
  - "[[03-dokument]]"
  - "[[Q070 Překlady textů UI]]"
  - "[[M10-ui]]"
supersedes:
tags:
  - adr
created: 2026-10-13
updated: 2026-10-13
---
# 0014 – Překlady: `vue-i18n` v `ui`, klíče v doméně

- **Stav:** Přijato (`status: accepted`)
- **Datum:** 2026-10-13
- **Souvisí:** [[Q070 Překlady textů UI|Q070]], [[11-ui]], [[03-dokument]], [[0009-platformove-nezavisla-domena|ADR 0009]]

## Kontext

UI má být česky i anglicky s přepínačem. Texty pro uživatele ale vznikají i v doméně (prstenec 1): popisky ve [[Schéma featury|schématu featury]], chyby validace (`ParamIssue`), výchozí název nové featury a popisek [[Transakce|transakce]] pro historii undo. Doména nesmí záviset na Vue ([[0009-platformove-nezavisla-domena|ADR 0009]]) a nový typ featury nemá vyžadovat změnu v `ui`.

## Rozhodnutí

- `ui` používá knihovnu **`vue-i18n`** (Composition API, `useI18n`) pro všechny texty, které zobrazuje. Jazyky `cs` a `en`, výchozí podle prohlížeče, volba se pamatuje v `localStorage`.
- Doména nese **jen klíče**, nikdy hotové věty:
  - `label` ve `ParamSpec`, `FeatureSchema` a u možností `enum` je klíč překladu (`'box.width'`),
  - `ParamIssue` má místo `message` kód a parametry: `{ param, code, params? }` (`'param.mustBePositive'`),
  - popisek transakce je klíč, přeloží se až při zobrazení.
- `FeaturePlugin` dostane volitelné pole `messages: { cs: …; en: … }` se slovníkem svých klíčů. `ui` slovníky pluginů při startu přidá do instance `vue-i18n`.
- Název nové featury (`Kvádr 1`) se vygeneruje v aktuálním jazyce a uloží jako běžný text. Přepnutí jazyka existující featury nepřejmenuje (stejně jako Fusion).
- Akce a transakce, které dělají totéž, sdílejí klíč (`feature.edit`, `feature.delete`, `feature.suppress`): stejný text je v menu i v historii undo, proto je ve tvaru příkazu („Upravit featuru“).
- Testy: každý plugin ověřuje svůj slovník; souhrnný test v `app` (`plugins.test.ts`) ověří, že každý `label` všech `BUILT_IN_PLUGINS` má text v `cs` i `en` (`ui` pluginy importovat nesmí). Vestavěné klíče a kódy chyb ověřuje `ui`.

## Zvažované alternativy

- **Vlastní malá funkce `t()`** – stačila by, ale `vue-i18n` dává hotové formátování čísel, plurály a reaktivní přepnutí jazyka, a je to standard, který se Pavel naučí.
- **`{ cs, en }` přímo ve schématu** – doména by znala seznam jazyků, každý další jazyk by měnil všechna schémata.

## Důsledky

- \+ Doména zůstane bez jazyků a bez Vue, chyby validace jdou testovat podle kódu, ne podle textu.
- \+ Nový jazyk = slovníky, žádná změna schémat.
- − Nová závislost `vue-i18n` (jen v `ui`, v tabulce závislostí spec 01).
- − Změna kontraktu `ParamSpec`, `ParamIssue` a `FeaturePlugin`: úprava `document`, `features/box`, `interaction` (`FieldState.issue`) a jejich testů.
- − Chybějící překlad se pozná až testem, ne překladačem.
