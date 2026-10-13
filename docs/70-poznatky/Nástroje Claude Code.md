---
type: insight
status: seed
aliases:
  - Claude Code v projektu
  - Skilly a hooky
topics:
  - claude code
  - automatizace
  - second brain
sources:
  - https://docs.claude.com/en/docs/claude-code/hooks
  - https://docs.claude.com/en/docs/claude-code/skills
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# Nástroje Claude Code

**Shrnutí:** pravidla, která se dají zkontrolovat strojově, má hlídat hook. Postupy, které vyžadují úsudek, patří do skillu. Paměť a CLAUDE.md jsou až poslední záchrana.

## Podrobnosti

Claude Code nabízí několik úrovní rozšíření. Liší se tím, **kdo** je spouští a **jak spolehlivě**:

| Nástroj | Kdo spouští | Spolehlivost | Na co |
|---|---|---|---|
| CLAUDE.md | Claude ho čte na začátku | závisí na tom, jestli si vzpomene | kontext, principy |
| Skill (`.claude/skills/<název>/SKILL.md`) | Claude podle popisu, nebo uživatel přes `/název` | návod se načte, až je potřeba | opakované postupy s úsudkem |
| Hook (`.claude/settings.json`) | harness při každém volání nástroje | deterministicky, vždy | kontroly a zákazy |
| Subagent (`.claude/agents/`) | Claude, v odděleném kontextu | podle zadání | revize, rešerše |
| Plugin / MCP server | instalace | – | balíček skillů a hooků, přístup k externím datům |

Hook s návratovým kódem 2 zablokuje akci (PreToolUse), nebo vrátí chybu Claudovi k opravě (PostToolUse). Tak se z pravidla „nic nemaž“ stane zákaz místo prosby.

## Jak to využívá tinycad

Pravidla z [[Konvence vaultu]] jsou rozdělená takto:

- **Hooky:** `scripts/vault-lint.mjs` po každé úpravě poznámky nastaví `updated` a zkontroluje frontmatter a wikilinky. `scripts/claude-guard.mjs` blokuje mazání v `docs/` a přepisování inboxu.
- **Skilly:** `/milnik` (start a konec milníku podle [[Roadmapa|Roadmapy]]), `/zaznam` (otázka, ADR, pojem ze šablony), `/denik` a `obsidian-format` (syntaxe).
- **Od [[M00-zaklad-projektu|M0]]:** `lint:vault` v `npm run check`, prettier a eslint jako hook (`scripts/code-format.mjs`), subagent `architecture-reviewer` na kontrolu architektury proti [[01-architektura]] a [[0011-programovani-proti-rozhranim|ADR 0011]]. Co jde zkontrolovat strojově (zakázaný `export class` v `index.ts`), hlídá ESLint; úsudek (široká rozhraní, logika ve `.vue`) subagent.

- **Od [[M03-operace|M3]] (pokus):** subagent `implementer` s modelem Sonnet implementuje úkoly z Implementačního plánu milníku. Hlavní sezení (Opus) dělá specifikaci, plán a kontrolu. Rozdělení podle schopností modelu: úsudek a návrh tam, kde se rozhoduje, mechanický převod přesné spec na kód levnějším modelem. Subagent nesmí rozhodovat návrh, jinak by se ztratilo pravidlo „nerozhoduj potichu“.
  - **Zkušenost z M3:** postup funguje, když je spec dotažená na kontrakt (signatury, krajní případy, seznam testů) a hlavní sezení po každém úkolu čte kód proti spec. Implementer se dvakrát zastavil s přesnou otázkou (díra v pravidle rollback baru, `begin` při výjimce odběratele) místo tichého rozhodnutí; díry, které spec neřešila, se tak dostaly do vaultu. Zbylé chyby (přepsané výjimky ve `finally`, reentrance) našel až `architecture-reviewer` – revize na konci milníku má smysl i při kontrole po úkolech.
- **Od [[M04-persistence|M4]]:** `implementer` běží na modelu **Opus** místo Sonnetu (Pavel). Důvod: úkoly M3 nebyly „mechanický převod“ – vyžadovaly úsudek u krajních případů a výjimek, a cena chyby, kterou musí najít až revize, je vyšší než úspora za levnější model.

Souvisí s [[Second brain v Obsidianu]]: vault je zdroj pravdy a nástroje hlídají, aby zůstal konzistentní.

## Zdroje

- Dokumentace Claude Code: hooks, skills (viz `sources`).
