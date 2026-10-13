---
type: question
status: answered
area: "[[11-ui]]"
decide_by: "[[M10-ui]]"
proposal: "Klíče překladu ve schématech a v chybách validace, slovníky cs/en dodává plugin, vlastní malá funkce t() v ui."
decision: "vue-i18n v ui, v doméně jen klíče (label, ParamIssue.code), slovníky cs/en dodává plugin."
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q070 Překlady textů UI

**Oblast:** [[11-ui]], [[03-dokument]] · **Rozhodnout do:** [[M10-ui]]

## Otázka

UI má být česky i anglicky s přepínačem (rozhodnutí 2026-10-13). Texty pro uživatele dnes vznikají i mimo `ui`, jako hotové řetězce:

- `ParamSpec.label` a `FeatureSchema.label` ve [[Schéma featury|schématu featury]] (`'Width'`…),
- `ParamIssue.message` z `validate` (box vrací `'Must be greater than 0'`),
- výchozí název nové featury (`nextFeatureName(…, schema.label)` ve `FeatureEditor`), který se uloží do dokumentu,
- popisek [[Transakce|transakce]] (`ops.begin(label)`), který se ukáže v historii undo.

Jak je přeložit, aby doména nemusela znát jazyky a nový typ featury pořád znamenal „nic v UI“?

## Možnosti a návrh

1. **Klíče překladu + slovníky od pluginu.** `label: 'box.width'`, `ParamIssue` dostane `code` a `params` (`{ code: 'param.mustBePositive' }`) místo hotové věty. `FeaturePlugin` dostane volitelné `messages: { cs: {…}, en: {…} }`, `ui` má vlastní `t(key, params)` (pár desítek řádků) a slovník vestavěných textů.
   - \+ Doména nese jen identifikátory, jazyky zná jen `ui` a plugin. Chyby validace jde překládat a testovat podle kódu.
   - − Rozšíří se `plugin-api` a `ParamIssue`. Chybějící klíč se pozná až za běhu (pomůže test „každý klíč schématu má překlad v obou jazycích“).
2. **`LocalizedText = { cs: string; en: string }` přímo ve schématu a v `ParamIssue`.**
   - \+ Jednoduché, chybějící jazyk chytí TypeScript.
   - − Doména zná seznam jazyků, další jazyk mění všechna schémata.
3. **Knihovna `vue-i18n`.**
   - \+ Standard, plurály, formát čísel.
   - − Nová závislost (ADR). Pro schémata stejně potřebuje 1 nebo 2, takže řeší jen vestavěné texty `ui`.

Návrh: **1**. Název nové featury se vygeneruje v aktuálním jazyce a uloží jako běžný text, stejně jako to dělá Fusion. Přepnutí jazyka už existující featury nepřejmenuje. Popisek transakce bude také klíč a přeloží se až při zobrazení.

## Rozhodnutí

2026-10-13 (Pavel): **`vue-i18n` + klíče v doméně.** Podrobnosti v [[0014-preklady-vue-i18n-a-klice|ADR 0014]]. Propsáno do [[03-dokument]] a [[11-ui]].
