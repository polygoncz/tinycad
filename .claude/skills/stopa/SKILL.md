---
name: stopa
description: Souběžné stopy tinycad podle metodiky – rozdělení série milníků do stop a jejich spuštění ve vlastních worktree, nebo sloučení hotové stopy do main. Použij, když Pavel řekne „rozdělíme to do stop“, „/stopa start M30–M33“, „slouč stopu B“, „/stopa sloucit stopa-b“.
argument-hint: start <milníky> | sloucit <stopa>
disable-model-invocation: true
---

# Stopa: start / sloucit

Argumenty: `$ARGUMENTS` (např. `start M30-M33`, `sloucit stopa-b-m31`). Metodika a její zdůvodnění: `docs/70-poznatky/Souběžné stopy agentů.md` – přečti ji před prvním použitím v sezení. Dnešní datum zjisti `date +%F`. Vault měň podle `docs/00-meta/Konvence vaultu.md`.

Hlavní sezení (ty) je **dispečer**: rozhoduje s Pavlem, píše kontrakty, spouští a slučuje stopy. Stopy implementují. Nic nerozhoduj potichu.

## start

1. **Milníky.** Přečti zadané milníky, jejich specifikace a otevřené otázky s `decide_by` na ně. Hrubé plány nejdřív upřesni s Pavlem (jako `/milnik start`, krok 6).
2. **Mapa souborů.** Pro každý milník vypiš soubory a moduly, které změní. Ukaž Pavlovi tabulku milník × soubor a navrhni stopy: skupiny s malým průnikem souborů; milníky ve stejných souborech nebo stavějící na sobě patří do jedné stopy za sebou. Úkol, který potřebuje výsledek jiné stopy, odděl a označ (*čeká na …*). Nech Pavla rozdělení schválit.
3. **Sdílené předem.** S Pavlem rozhodni otevřené otázky. Do spec zafixuj kontrakty **sdílených typů** (členy unií, nové varianty, které přidá každá stopa) a do milníků implementační plány. Oprav `depends_on` tak, aby odpovídalo skutečným závislostem, ne pořadí. Do Roadmapy přidej sekci série s tabulkou stop a pravidly (vzor: *Souběžné stopy (pokus od M25)*), do každého milníku sekci *Průběh stopy*.
4. **Commit** do `main` (`npm run check` zelený). Ten commit je výchozí bod všech stop.
5. **Spuštění.** Pro každou stopu `start_session` s `initiation: "user_asked"` (Pavel spuštění schválil v kroku 2), `context: "fresh"`, `use_worktree: true`, `source_branch: "main"`, krátkým `name` a `branch_name`. Brief obsahuje:
   - co přečíst (CLAUDE.md, Konvence vaultu, sekci série v Roadmapě, spec a milníky stopy);
   - postup jako hlavní sezení CLAUDE.md (subagent `implementer` na úkol, kontrola proti spec, vysvětlení Pavlovi, `architecture-reviewer`, uzavření milníku);
   - pravidla stop (vault jen vlastní milník a sekce spec, *Průběh stopy* místo deníku, číslo otázky až po kontrole `main`, wikilink na poznámku z jiné větve jen textem, commit na větev, do `main` neslučovat, před koncem natáhnout `main` přes `sync_with_base_branch`);
   - souběžné stopy a soubory, kde hrozí konflikt;
   - „hotovo když“ a jak hlásit stav.
6. Řekni Pavlovi, ať si otevře panel **`/stopy`**, a nastav kroky plánu (`update_plan`) se `session` u každé stopy.

**Během stop:** otázky stop předávej Pavlovi a jeho odpověď posílej zpět s doslovnou citací a s **úplným stavem** rozhodnutí (zprávy se kříží). Stopu, která čeká na jinou, pusť zprávou až po sloučení té druhé. Stav hlásit krátce, vždy stejně: co je v `main`, co je hotové ve větvi, co běží, co čeká a na co.

## sloucit

1. Ověř, že stopa dokončila svou část: milníky ve větvi `status: done` (nebo dohodnutá část), `git -C <worktree> status` čistý, zpráva stopy hlásí zelený check a e2e.
2. `git log main..<větev>`, `git merge-base --is-ancestor main <větev>` (obsahuje stopa aktuální `main`?), přečti *Průběh stopy* a zkontroluj diff proti kontraktu ve spec u nejcitlivějších míst (sdílené typy, adaptéry, hranice modulů).
3. `git merge --no-ff <větev>` v hlavním checkoutu se zprávou `Merge track X: Mnn …` a řádkem `Co-Authored-By`. Konflikty řeš tady: sčítací (obě strany přidaly) ponech obě; u ostatních čti obě strany a spec.
4. **Vždy celý `npm run check`** – sémantické konflikty git nehlásí, najde je typecheck (vyčerpávající `switch`). Pak `npm run test:e2e` (běží-li dev server, `E2E_PORT=<volný port>`). Nic necommituj, dokud obojí neprojde.
5. Úkoly, které stopa předala hlavnímu sezení (doplnění cizí spec, wikilinky na poznámky z jiných větví), udělej teď.
6. Přenes *Průběh stopy* do dnešního deníku (sekce „Sloučení stopy …“: co přibylo, rozhodnutí, konflikty, výsledky testů, otevřené body) a commitni.
7. Zbylým stopám pošli zprávu: co je nového v `main`, kde čekat konflikty a co ověřit. Stopě, která čekala na tuto, dej pokyn pokračovat.
8. Po poslední stopě série navrhni retrospektivu: data z gitu (časy, commity, konflikty), Pavlův pohled, zhodnocení do metodiky a Roadmapy.
