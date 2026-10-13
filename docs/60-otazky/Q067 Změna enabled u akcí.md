---
type: question
status: answered
area: "[[10-interakce]]"
decide_by: "[[M09-interakce]]"
proposal: "refresh() volaný z app"
decision: "Action.enabled je Observable<boolean>, registr se přihlásí sám"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q067 Změna enabled u akcí

**Oblast:** [[10-interakce]] · **Rozhodnout do:** [[M09-interakce]]

## Otázka

`ActionRegistry` vystavuje snapshot `ActionState[]` včetně `enabled` ([[Akce]], [[Prezentační model]]). Když je `enabled()` funkce, registr neví, kdy se změnila.

## Možnosti a návrh

1. **`refresh()`** – `app` ho volá po událostech dispečera a výběru; registr přepočítá snapshot a emituje jen při rozdílu.
   - + málo kódu. − snadno se zapomene zavolat.
2. **`enabled: Observable<boolean>`** – registr se přihlásí ke každé akci.
   - + přesné, žádné ruční obnovování. − víc kódu u každé akce.

Návrh: 1.

## Rozhodnutí

2026-10-13 (Pavel): **možnost 2.** Registr se k `enabled` přihlásí při `register` a snapshot `actions` přepočítá při změně. Propsáno do [[10-interakce]].
