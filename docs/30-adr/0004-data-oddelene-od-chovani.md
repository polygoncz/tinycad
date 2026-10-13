---
type: adr
status: accepted
number: 4
aliases:
  - ADR 0004
  - Featury jako data, chování v registrovaných builderech
date: 2026-10-12
related:
  - "[[03-dokument]]"
  - "[[07-regenerace]]"
  - "[[11-ui]]"
supersedes: 
tags:
  - adr
created: 2026-10-12
updated: 2026-10-12
---
# 0004 – Featury jako data, chování v registrovaných builderech

- **Stav:** Přijato (`status: accepted`)
- **Datum:** 2026-10-12
- **Souvisí:** [[03-dokument]], [[07-regenerace]], [[11-ui]]

## Kontext

V prvním náčrtu v konverzaci měla featura metodu `regenerate(ctx)` přímo na sobě (klasická OOP třída s daty i chováním). To ale znamená:
- dokument (`document`) by závisel na jádru a regeneraci, protože `RegenContext` obsahuje jádro,
- serializace by musela z dat znovu vyrábět instance tříd,
- operace v logu by nesly objekty s chováním, ne čistá data.

Současně chceme, aby přidání nové featury bylo „jeden nový modul a jeden řádek registrace“.

## Rozhodnutí

- `FeatureInstance` je **neměnný datový objekt** (`id`, `type`, `params`, …).
- Typ featury je popsaný třemi částmi, každá ve své vrstvě a ve svém registru:
  - `FeatureSchema` (`document`) – parametry, výchozí hodnoty, validace, migrace,
  - `FeatureBuilder` (`regen`) – výpočet geometrie,
  - `ToolDescriptor` (`interaction`) – nástroje pro tvorbu.
- `FeaturePlugin` (`plugin-api`) je spojuje do jednoho balíku; `app` je při startu rozdělí do registrů.
- Stejný vzor platí pro operace: `Operation` (data) + `OpHandler` (chování).

Jde stále o objektový návrh – buildery, handlery a registry jsou objekty s rozhraním – jen je chování oddělené od dat podle typu (podobně jako *strategy* + *registry*).

## Zvažované alternativy

- **Bohaté třídy featur (`class BoxFeature { regenerate() }`)** – přirozenější z pohledu klasického OOP, ale porušuje směr závislostí a komplikuje serializaci a neměnnost.
- **Jeden velký registr se vším** – jednodušší, ale registr by závisel na všech vrstvách.

## Důsledky

- + `document` nezávisí na jádru; dokument jde načíst a migrovat bez WASM.
- + Data jsou triviálně serializovatelná a porovnatelná identitou.
- + Nový typ featury nemění existující kód (open/closed).
- − Tři registry místo jednoho; vazba mezi nimi je přes řetězec `type` a hlídá ji test („každý registrovaný typ má schéma i builder“).
