# tinycad – kontext pro Claude

Výuková webová CAD aplikace (Onshape-like Part Studio). Autor: Pavel. Pavel zná dobře C++ a OpenCascade (desktop), Laravel a Kotlin; Vue a TypeScript zná jen povrchně. Projekt je **výukový**: cílem je pochopit návrh, ne jen mít hotový kód.

## Dokumentace = Obsidian vault v `docs/`

`docs/` je Pavlův second brain v Obsidianu a **zdroj pravdy o návrhu**. Pavel ho čte v Obsidianu, takže formát musí sedět Obsidianu (wikilinky, vlastnosti, Bases).

- Vstupní bod: `docs/Domů.md`. Pravidla vaultu: **`docs/00-meta/Konvence vaultu.md` – přečti před první úpravou vaultu v sezení** a dodržuj je (hlavně sekci „Pravidla pro Clauda“).
- Rychlá orientace: specifikace `docs/20-spec/`, rozhodnutí `docs/30-adr/`, roadmapa a milníky `docs/40-plan/`, pojmy `docs/50-pojmy/`, otázky `docs/60-otazky/`, deník `docs/80-denik/`.
- Hledání: podle vlastností ve frontmatteru (`type:`, `status:`, `decide_by:`…), např. `grep -l 'status: open' docs/60-otazky/*`, `grep -l 'status: doing' docs/40-plan/*`.
- Odkazy vždy jako wikilinky `[[poznámka]]` / `[[poznámka|text]]`, v tabulkách `[[poznámka\|text]]`. Žádné markdown odkazy na soubory ve vaultu.

## Jak pracujeme

1. Práce postupuje podle `docs/40-plan/Roadmapa.md`, milník po milníku, **odspodu nahoru**.
2. Při zahájení milníku nastav v jeho vlastnostech `status: doing` a `started`. Přečti milník, odkazované specifikace a otevřené otázky s `decide_by` na tento milník.
3. Pracuj po malých krocích. U každého netriviálního návrhového rozhodnutí krátce vysvětli **proč** – Pavel se chce učit.
4. Po dokončení úkolu zaškrtni checkbox v milníku. Po dokončení milníku `status: done`, `finished`, retrospektiva, obecné poznatky do `docs/70-poznatky/`.
5. Když se implementace odchýlí od specifikace, **uprav specifikaci** ve stejném kroku. Zásadní rozhodnutí (nová knihovna, hranice modulů, formát dat) → nové ADR šablonou `00-meta/sablony/ADR.md`.
6. Nejasnost v návrhu → nová poznámka v `docs/60-otazky/` (šablona *Otázka*) a zeptej se Pavla. Nerozhoduj potichu.
7. Na konci každého sezení zapiš nebo doplň dnešní záznam v `docs/80-denik/RRRR-MM-DD.md` a aktualizuj `updated` u změněných poznámek.
8. Nic ve vaultu nemaž – nepotřebné přesuň do `docs/90-archiv/`.

### Rozdělení specifikace a implementace (pokus od M3)

- **Hlavní sezení (s Pavlem):** rozhodnout otázky, dotáhnout specifikaci na úroveň kontraktu (signatury, krajní případy, invarianty, seznam testů) a sepsat **Implementační plán** v poznámce milníku (úkoly se soubory, kontraktem, testy a „hotovo když“).
- **Implementace:** každý úkol plánu zvlášť subagent `implementer` (Opus, TDD, `npm run check`). Návrh nerozhoduje, nejasnosti vrací jako otázky.
- **Po každém úkolu:** hlavní sezení zkontroluje kód proti specifikaci, vysvětlí Pavlovi návrhová místa, otázky implementátora převede na otázky ve vaultu nebo upřesnění spec, zaškrtne úkol. Na konci milníku `architecture-reviewer`.

## Konvence kódu

- **Kód, identifikátory, komentáře v kódu, commit zprávy:** anglicky. **Vault:** česky.
- TypeScript `strict`, žádné `any` (výjimka jen v adaptéru OCCT, izolovaná a okomentovaná).
- Každý modul v `src/` má veřejné API jen přes svůj `index.ts`. Hluboké importy do cizího modulu jsou zakázané. Pomůcky pro testy (buildery `aFeature()`, `aDocument()`…) jsou v `testing.ts` modulu a smí je importovat jen testy. Testy leží mimo `src/` v `test/unit/<modul>/` se zrcadlovou strukturou (`src/interaction/foo.ts` → `test/unit/interaction/foo.test.ts`), importují přes `@/`; integrační v `test/integration/`, e2e v `test/e2e/` (ADR 0023).
- Pravidla závislostí mezi moduly jsou v `docs/20-spec/01-architektura.md` a vynucuje je dependency-cruiser (`npm run lint:deps`).
- Doménová data jsou **neměnná** (immutable). Změna = nový objekt.
- Dokument mění **jen** handlery operací (`src/ops`). Nikdo jiný nedostane `DocumentWriter`.
- Doménové objekty a objekty Three.js se nikdy nevkládají do Vue `reactive()`; UI je čte přes composables (viz `docs/20-spec/11-ui.md`).
- Ke každému modulu patří testy (Vitest). Před dokončením úkolu musí projít `npm run check` (typecheck + lint + lint:deps + test).

## Nástroje Claude Code (`.claude/`)

- Skilly: `/milnik start|konec Mnn`, `/zaznam otazka|adr|pojem|poznatek <název>`, `/denik` (konec sezení). Skill `obsidian-format` (syntaxe vaultu) se načítá automaticky.
- Subagent `architecture-reviewer` (`.claude/agents/`): revize kódu proti ADR 0008–0011 a spec 01, hlásí jen to, co nechytí `npm run check`. Spouštět na konci milníku před `/milnik konec`.
- Subagent `implementer` (`.claude/agents/`, model Opus): implementuje jeden úkol z Implementačního plánu milníku podle spec, metodou TDD; vault nemění, necommituje, nejasnosti vrací jako otázky.
- Hooky: po úpravě poznámky v `docs/` se nastaví `updated` na dnešek a zkontroluje se frontmatter a wikilinky (`scripts/vault-lint.mjs`). Mazání v `docs/` a přepisování `docs/01-inbox/` blokuje `scripts/claude-guard.mjs`. Když hook nahlásí chybu, oprav poznámku a hook neobcházej.

## Užitečné příkazy

- `node scripts/claude-guard.selftest.mjs` – test hooku `claude-guard` (co blokuje a co ne); spustit po každé úpravě hooku.
- `node scripts/vault-lint.mjs` – kontrola celého vaultu (od M0 i jako `npm run lint:vault` v `npm run check`).
- `npm run check` – vše, co musí projít před dokončením úkolu: `typecheck` + `lint` + `lint:deps` + `lint:vault` + `test`.
- `npm run dev` – vývojový server Vite (http://localhost:5173), `npm run build` – produkční build.
- `npm run typecheck` – `vue-tsc -b` nad všemi projekty: `tsconfig.domain.json` (prstence 1 a 2 bez DOM, ADR 0009), `tsconfig.app.json` (prohlížeč), `tsconfig.test.json` (testy v Node), `tsconfig.test-idb.json` (testy adaptéru IndexedDB, s typy DOM), `tsconfig.test-app.json` (testy `app` a `ui`, s typy DOM), `tsconfig.node.json` (konfigurace nástrojů).
- `npm run lint:deps` – hranice modulů (dependency-cruiser, `.dependency-cruiser.cjs`). Tabulka modulů v něm musí odpovídat tabulce v `docs/20-spec/01-architektura.md`.
- `npm test` – unit testy (Vitest, projekt `unit`), `npm run test:integration` – integrační testy v `test/integration/`, `npm run test:e2e` – Playwright v `test/e2e/`.
- `npm run format` – Prettier + `eslint --fix` nad celým projektem (vault v `docs/` se neformátuje).
- `npx depcruise src --config .dependency-cruiser.cjs --output-type dot | dot -T svg > deps.svg` – graf závislostí modulů (potřebuje Graphviz).
- Hook `scripts/code-format.mjs` po každé úpravě `src/**/*.{ts,vue}` spustí Prettier a `eslint --fix`.
