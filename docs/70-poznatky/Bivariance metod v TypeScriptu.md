---
type: insight
status: seed
aliases:
  - Method bivariance
  - strictFunctionTypes
topics:
  - TypeScript
  - typový systém
sources:
  - https://www.typescriptlang.org/tsconfig/#strictFunctionTypes
  - https://www.typescriptlang.org/docs/handbook/type-compatibility.html#function-parameter-bivariance
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# Bivariance metod v TypeScriptu

**Shrnutí:** TS porovnává parametry metod bivariantně i se `strictFunctionTypes`, parametry vlastností s typem funkce kontravariantně – zápis `build(x)` místo `build: (x) => …` rozhoduje, jestli jde `Plugin<Specific>` předat jako `Plugin<unknown>`.

## Podrobnosti

- Funkce, která přijímá jen `BoxParams`, správně **není** funkcí, která přijme cokoli (kontravariance parametrů). `strictFunctionTypes` to hlídá – ale jen pro vlastnosti s typem funkce.
- Metody (`build(input): …` v rozhraní) TS záměrně porovnává bivariantně, aby fungovaly běžné hierarchie (`Array<Dog>` jako `Array<Animal>`).
- Je to vědomá díra: za běhu je bezpečná jen tehdy, když něco jiného zaručí, že do metody přijdou správná data (v tinycadu validace schématem před voláním builderu).
- Přepis metody na vlastnost s typem funkce takovou kompatibilitu tiše rozbije – stojí za to ji hlídat testem, který jen typově předá konkrétní plugin.

## Jak to využívá tinycad

`FeaturePlugin<BoxParams>` jde do `registerPlugin` bez přetypování ([[11-ui#Plugin featury (plugin-api)|spec 11]]); [[Builder featury|builder]] dostává jen parametry ověřené schématem.

## Zdroje

- https://www.typescriptlang.org/tsconfig/#strictFunctionTypes
- https://www.typescriptlang.org/docs/handbook/type-compatibility.html#function-parameter-bivariance
