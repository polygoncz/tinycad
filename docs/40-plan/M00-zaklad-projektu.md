---
type: milestone
status: done
order: 0
aliases:
  - M0
  - M0 Základ projektu
modules: []
specs:
  - "[[01-architektura]]"
  - "[[13-testovani]]"
depends_on: []
started: 2026-10-13
finished: 2026-10-13
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-13
---
# M0 – Základ projektu

**Cíl:** prázdný, ale kompletně nastavený projekt, ve kterém `npm run check` hlídá typy, styl, testy i hranice modulů. Od začátku chceme, aby porušení architektury neprošlo.

**Specifikace:** [[01-architektura|01 – Architektura]], [[0008-hranice-modulu|ADR 0008]], [[0009-platformove-nezavisla-domena|ADR 0009]], [[13-testovani|13 – Testování]]

## Úkoly

- [x] Inicializovat Vite projekt (Vue + TypeScript), Node 26 ([[Q021 Verze Node]]), npm. TypeScript je zafixovaný na `~6.0`: TS 7 (nativní kompilátor) zatím nepodporuje `typescript-eslint`.
- [x] `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`. Alias `@/` → `src/`.
- [x] `tsconfig.test.json` pro testy (typy Node), aby `tsconfig.app.json` zůstal bez Node. *(přidáno během práce)*
- [x] `tsconfig.domain.json` pro prstence 1 a 2 ([[0009-platformove-nezavisla-domena|ADR 0009]]): `"lib": ["ES2023"]` bez `DOM`, vyjmout `persistence/idb`. Typecheck spouští obě konfigurace.
- [x] Vytvořit prázdné moduly podle [[01-architektura#Adresářová struktura|struktury]], každý s `index.ts` (zatím `export {}`).
- [x] Vitest: konfigurace, jeden ukázkový test, projekty `unit` a `integration` (zatím prázdný).
- [x] ESLint (flat config, `typescript-eslint` strict + `eslint-plugin-vue`) a Prettier.
- [x] dependency-cruiser: pravidla z tabulky v spec 01, zákaz cyklů, zákaz hlubokých importů mimo `index.ts`.
- [x] Ověřit, že pravidlo funguje: dočasný zakázaný import (`document` → `kernel`) musí `lint:deps` shodit. Pak odstranit.
- [x] Ověřit vynucení bez DOM: dočasné použití `window` v `document` musí shodit `typecheck`. Pak odstranit.
- [x] ESLint `no-restricted-globals` (`window`, `document`, `requestAnimationFrame`, `indexedDB`…) pro prstence 1 a 2 jako druhá pojistka.
- [x] Skripty: `dev`, `build`, `typecheck` (`vue-tsc -b` nad všemi projekty včetně `tsconfig.domain.json`), `lint`, `lint:deps`, `lint:vault` (`node scripts/vault-lint.mjs`), `test`, `test:integration`, `check` (= typecheck + lint + lint:deps + lint:vault + test).
- [x] Hooky Claude Code pro kód: po úpravě `src/**/*.{ts,vue}` spustit `prettier --write` a `eslint --fix` (viz [[Nástroje Claude Code]]).
- [x] `src/main.ts` + `App.vue` s nápisem „tinycad“ – ověří, že Vite a Vue běží.
- [x] `.editorconfig`, `.nvmrc`; doplnit `.gitignore` (základ s výjimkami pro Obsidian už existuje).
- [x] Doplnit sekci „Užitečné příkazy“ v `CLAUDE.md`.
- [x] (Pavel) `git init` a první commit na Macu.

## Akceptační kritéria

- `npm run dev` ukáže stránku s nápisem.
- `npm run check` projde.
- Zakázaný import mezi moduly `npm run check` shodí s čitelnou chybou.
- Použití globálního objektu prohlížeče v doméně nebo v `interaction` `npm run check` shodí.

## Co se naučíš

Nastavení TS ve strict módu a co jednotlivé přepínače hlídají; jak vynutit architekturu nástrojem.

## Retrospektiva

> [!note] Návrh od Clauda – Pavle, doplň nebo uprav.

**Co bylo jinak, než se čekalo**
- Milník se rozrostl o architektonické rozhodnutí: požadavek na přenositelnost vedl k [[0009-platformove-nezavisla-domena|ADR 0009]] (tři prstence, `ViewportPort`) a [[0010-prezentacni-model|ADR 0010]]. Při revizi specifikací se našly dvě skryté závislosti na platformě: `interaction → render` a `KeyboardEvent` v `ActionRegistry`. Na papíře je nikdo nehlídal.
- Nejnovější verze nástrojů do sebe nezapadly: TypeScript 7 (nativní kompilátor) zatím nepodporuje `typescript-eslint`, proto zůstáváme na `~6.0`. ESLint 10 načte konfiguraci v TS jen s knihovnou `jiti`.
- Místo dvou konfigurací TS jsou čtyři (`domain`, `app`, `test`, `node`). Testy potřebují typy Node, kód pro prohlížeč je mít nemá. Přepínač `composite` se na překrývající se projekty nehodí.
- Plán počítal s Node 22, používáme Node 26 ([[Q021 Verze Node]]).

**Co se osvědčilo**
- Každou kontrolu ověřit úmyslně chybným kódem. Kromě importu `document → kernel` jsme vyzkoušeli dalších 7 druhů porušení a všechny se chytily.
- Pravidla dependency-cruiseru generovaná z tabulky modulů (whitelist): chybová hláška rovnou říká, co modul smí, a nový modul je jeden řádek.
- Dvě nezávislé pojistky proti platformě v doméně: `lib` bez `DOM` v typecheck a `no-restricted-globals` v ESLintu.

