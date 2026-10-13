---
type: insight
status: seed
aliases:
  - i18n v doménovém modelu
topics:
  - architektura
  - i18n
sources:
  - https://vue-i18n.intlify.dev/
  - https://formatjs.io/docs/core-concepts/icu-syntax/
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# Klíče překladu v doméně

**Shrnutí:** Doména, která nesmí znát UI, nese místo hotových vět jen klíče a strukturované kódy (`{ code: 'param.atOrBelowMin', params: { min: 0 } }`); překládá až vrstva UI.

## Podrobnosti

- Požadavek „víc jazyků“ vypadá jako věc UI, ale texty vznikají i v doméně: popisky ve schématech, chyby validace, výchozí názvy, popisky transakcí v historii undo.
- **Kód + parametry místo věty** dávají víc než překlad: chyba jde testovat podle kódu, UI ji může zobrazit u správného pole, text s mezí se poskládá v jazyce uživatele.
- Technické zprávy (z jádra, z výjimek) zůstávají technickým textem pod přeloženým nadpisem – nepřekládat všechno.
- **Data uložená v dokumentu** (název featury „Kvádr 1“) se generují v aktuálním jazyce a dál jsou to data uživatele; přepnutí jazyka je nepřejmenuje. Klíče v logu (popisky transakcí) se překládají až při zobrazení.
- Slovníky dodává ten, kdo klíče zavádí (plugin featury), a test výčtem hlídá, že každý klíč má text ve všech jazycích.

## Jak to využívá tinycad

[[0014-preklady-vue-i18n-a-klice|ADR 0014]], [[03-dokument]] (`ParamIssue`, `label`), [[11-ui]] (`vue-i18n`, `addPluginMessages`).

## Zdroje

- vue-i18n (Composition API).
- ICU MessageFormat (parametry a plurály v textech).
