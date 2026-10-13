---
type: concept
aliases:
  - Presentation Model
  - View-model
  - ViewModel
code: "Observable"
module: "interaction"
summary: "Obyčejná TS třída s logikou obrazovky: vystavuje neměnný snapshot a příkazy, pohled se na ni jen váže."
related:
  - "[[Port a adaptér]]"
  - "[[Neměnná data]]"
  - "[[Nástroj]]"
tags:
  - pojem
created: 2026-10-13
updated: 2026-10-13
---
# Prezentační model

Třída bez závislosti na UI frameworku, která drží logiku jedné obrazovky (strom featur, dialog featury, toolbar). Pohledu vystavuje stav jako `Observable<T>` (neměnný snapshot + oznámení o změně) a příkazy, které pohled volá. Na rozdíl od presenteru v MVP do pohledu nikdy nezapisuje, pohled si stav čte sám přes data binding. Díky tomu se dá testovat v Node a přenést pod jiný framework. V tinycad leží v modulu `interaction` (např. `FeatureTreeModel`, `FeatureEditSession`).

**V návrhu:** [[0010-prezentacni-model]], [[10-interakce]], [[11-ui]]
**Souvisí:** [[Port a adaptér]], [[Neměnná data]], [[Nástroj]]
