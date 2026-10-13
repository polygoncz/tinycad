---
name: zaznam
description: Založení nové poznámky ve vaultu tinycad ze šablony – otázka (Qnnn), ADR, pojem, poznatek nebo specifikace – se správným číslováním, frontmatterem a odkazy. Použij vždy, když v návrhu vznikne nejasnost, zásadní rozhodnutí, nový pojem nebo obecný poznatek.
argument-hint: otazka|adr|pojem|poznatek|spec <název>
---

# Nový záznam ve vaultu

Argumenty: `$ARGUMENTS`. Dnešní datum zjisti `date +%F`. Pravidla: `docs/00-meta/Konvence vaultu.md`.

## Společný postup

1. Načti šablonu z `docs/00-meta/sablony/` (`Otázka.md`, `ADR.md`, `Pojem.md`, `Poznatek.md`, `Spec.md`).
2. Nahraď `{{date:YYYY-MM-DD}}` dnešním datem a `{{title}}` názvem. Prázdné `[[ ]]` nahraď skutečnými odkazy, nebo řádek odstraň.
3. **Pravidlo dvou odkazů:** nová poznámka odkazuje aspoň na dvě existující poznámky, obvykle na specifikaci a pojem.
4. Pojem prolinkuj při první zmínce, další zmínky už ne. Odkazy ve vlastnostech piš v uvozovkách: `"[[07-regenerace]]"`. V tabulkách escapuj svislítko: `[[M01-core\|M1]]`.
5. Text piš česky. Hodnoty vlastností jsou anglické a krátké.
6. Kde to dává smysl, přidej zpětný odkaz z nadřazené poznámky. Vlastní text Pavla nepřepisuj, jen doplň.
7. Po uložení hook `vault-lint` zkontroluje frontmatter a odkazy. Když nahlásí chybu, oprav ji.

## Podle typu

### otazka → `docs/60-otazky/Qnnn Krátký název.md`
- Číslo: nejvyšší existující `Q` + 1, třemi číslicemi (`ls docs/60-otazky`).
- `area` = specifikace, které se otázka týká. `decide_by` = milník, do kterého se musí rozhodnout. `proposal` = jedna věta.
- V sekci *Možnosti a návrh* uveď 2–3 možnosti s výhodami a nevýhodami a svůj návrh s odůvodněním.
- **Nerozhoduj.** Po založení se Pavla zeptej (AskUserQuestion). Po rozhodnutí: sekce *Rozhodnutí*, `status: answered`, `decision`, propsat do specifikace. Zásadní rozhodnutí navíc jako ADR.

### adr → `docs/30-adr/NNNN-kratky-nazev.md`
- Číslo: nejvyšší existující + 1, čtyřmi číslicemi. Název souboru bez diakritiky, s pomlčkami. `number` je číslo bez nul. Alias `ADR NNNN` a alias s plným názvem.
- `status: proposed`, dokud ho Pavel neschválí. ADR se nepřepisují: když nahrazuje starší, vyplň `supersedes` a starému ADR nastav `status: superseded`.
- Doplň rozcestník `docs/30-adr/Rozhodnutí.md`, pokud v něm je ručně psaný seznam.

### pojem → `docs/50-pojmy/Název.md`
- Nejdřív hledej duplicity: `grep -ril '<název>' docs/50-pojmy/`, včetně `aliases`. Pokud pojem existuje, rozšiř ho místo zakládání nového.
- 2–6 vět. `code` = název v kódu, `module` = modul, `summary` = jedna věta.
- Přidej ho do `docs/50-pojmy/Glosář.md`, pokud má ruční seznam.

### poznatek → `docs/70-poznatky/Název.md`
- Obecná znalost, která přežije tinycad. Vždy se zdroji v `sources`. Začíná jako `status: seed`.

### spec → `docs/20-spec/NN-nazev.md`
- Jen po dohodě s Pavlem: nová specifikace mění strukturu návrhu. `order` = NN.
