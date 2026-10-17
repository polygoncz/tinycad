---
type: question
status: answered
area: "[[11-ui]]"
decide_by: "[[Roadmapa]]"
proposal: "Zdrojem schématu je C++ plugin; deklarativní část (parametry, druhy, meze, popisky, výchozí hodnoty) server posílá jako data při otevření sezení, chování (validate, migrate) zůstává jen na serveru."
decision: "Zdroj schématu v C++ pluginu; deklarativní část jde klientovi jako FeatureTypeDescriptor při otevření sezení; validate, defaults a migrate jen na serveru; texty v TS."
tags:
  - otazka
created: 2026-10-17
updated: 2026-10-17
---
# Q098 Schéma featur v klientovi

**Oblast:** [[11-ui]], [[03-dokument]], [[Q094 Nativní jádro na serveru přes gRPC|Q094]] · **Rozhodnout do:** [[Roadmapa|plánování série nativního jádra]] (po M37)

## Otázka

[[Plugin featury]] dnes spojuje `schema`, `builder`, `tools`, `manipulators` a `messages`. Po rozdělení půjde builder do C++, nástroje, manipulátory a překlady zůstanou v TS. [[Schéma featury]] ale potřebují obě strany:

- **server:** `validate` (validace jen na serveru, Q094 bod 3), `defaults` při `feature.add`, `migrate` při načtení starších dat,
- **klient:** dialog featury se kreslí ze `params` (druh parametru `length`, `angle`, `enum`, `topo`…, popisek, meze), Timeline bere `label` a `icon`.

Kde bude schéma definované a jak se k němu dostane druhá strana?

## Možnosti a návrh

Schéma má dvě části. **Deklarativní** (`type`, `version`, `label`, `icon`, `params` s `ParamSpec`, výchozí hodnoty) jsou data. **Chování** (`validate` s vlastními pravidly, `migrate`) je kód.

**A. Zdroj v C++, server posílá popis (návrh).** C++ plugin definuje schéma. Deklarativní část server pošle jako zprávu `FeatureTypeDescriptor` v odpovědi na `OpenDocument` (nebo samostatné `ListFeatureTypes`). Chování zůstane jen na serveru.
- \+ Jeden zdroj pravdy. Nová featura se v klientovi objeví bez změny TS, pokud nepotřebuje vlastní nástroj nebo manipulátor.
- \+ Sedí to s „server je autorita“ a s validací jen na serveru. Meze v popisu klient použije jen pro pohodlí (rozsah pole), rozhoduje odpověď serveru.
- − `ParamSpec` se musí dát vyjádřit v `.proto` (oneof přes druhy parametrů). Je to jednorázová práce.

**B. Schéma ve sdíleném souboru, generátor pro obě strany.** Deklarativní část v JSON nebo `.proto` options. Z něj se generují typy TS i C++.
- \+ Typy parametrů featury jsou v TS staticky známé (dnes `FeaturePlugin<P>`).
- − Další generátor a krok buildu. Klientská statická typovost parametrů se po rozdělení využije málo, protože dialog pracuje se schématem dynamicky.

**C. Schéma dvakrát, ručně.** TS i C++ verze vedle sebe, hlídané testem shody.
- − Přesně ten druh duplicity, kterému Q094 bod 3 předchází („pravidla nejsou na dvou místech“).

Návrh: **A**. Klíče překladů (`label`, `issue` kódy, [[0014-preklady-vue-i18n-a-klice|ADR 0014]]) zůstávají v TS (`messages`). Server posílá jen klíče, texty jsou věc UI.

## Rozhodnutí

**Varianta A (Pavel 2026-10-17, podle návrhu Clauda).** Zdrojem schématu je C++ plugin featury. Deklarativní část (`type`, `version`, `label` a `icon`, `params` jako `oneof` přes druhy `ParamSpec` s mezemi, výchozí hodnoty) server pošle jako `FeatureTypeDescriptor` při otevření sezení. `validate`, `defaults` a `migrate` jsou jen na serveru. Meze klient použije jen pro pohodlí v dialogu, rozhoduje odpověď serveru. Server posílá klíče překladů, texty zůstávají v TS (`messages`, [[0014-preklady-vue-i18n-a-klice|ADR 0014]]).

Klientská půlka [[Plugin featury|pluginu featury]] tak drží jen `tools`, `manipulators` a `messages`. Do specifikací ([[11-ui]], [[03-dokument]]) se to propíše při plánování série nativního jádra.
