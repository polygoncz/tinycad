---
type: insight
status: seed
aliases:
  - Vlny implementace
  - Paralelní agenti ve worktree
topics:
  - proces
  - AI agenti
  - git
sources:
  - https://git-scm.com/docs/git-worktree
  - https://docs.anthropic.com/en/docs/claude-code/sub-agents
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# Paralelní implementace ve vlnách

**Shrnutí:** Implementační plán rozdělený do vln úkolů s oddělenými soubory jde dělat několika agenty souběžně, každým ve vlastním git worktree, a sloučit bez konfliktů, když plán předem určí, kdo vlastní sdílené soubory.

## Podrobnosti

- **Vlna = úkoly bez závislostí mezi sebou.** Další vlna začíná až po sloučení předchozí, protože staví na jejích typech. V [[M10-ui]] šest vln, nejvíc čtyři úkoly souběžně.
- **Sdílené soubory mají vlastníka.** Typicky `index.ts` modulu: smí ho měnit jen jeden úkol vlny. Ostatní to vědí ze zadání a nové exporty jen nahlásí.
- **Worktree, ne jedna pracovní kopie.** Rozdělaná práce jednoho agenta by jinému rozbila `npm run check`. Worktree sdílí historii, ne pracovní soubory. `node_modules` jde do worktree přes symlink; balíčky instaluje jen hlavní sezení předem, jinak by instalace symlink rozbila.
- **Sloučení patchem:** `git add -A` ve worktree → `git diff --cached --binary HEAD` → `git apply --3way` v hlavní kopii → `npm run check` → commit vlny → smazat worktree. Lint a formátovač musí worktree adresáře ignorovat, jinak hlásí cizí kopie kódu.
- **Kde to drhne:** změna kontraktu, která prosákne přes vrstvy (tvar `ParamIssue` rozbil `regen`), nebo úkol napříč vrstvami. Ten patří do samostatné vlny s jedním agentem.
- **Revize po vlně je místo pro rozhodnutí.** Otázky agentů se mezi vlnami převedou na rozhodnutí ve spec a doplňkové úkoly (vlny A2, C2), místo aby je agent rozhodl potichu.

## Jak to využívá tinycad

Postup „hlavní sezení plánuje, `implementer` implementuje“ ([[Nástroje Claude Code]]) od [[M10-ui]] po vlnách; plán vln je tabulka v implementačním plánu milníku.

## Zdroje

- git-worktree: více pracovních stromů jednoho repozitáře.
- Claude Code: subagenti a izolace ve worktree.
