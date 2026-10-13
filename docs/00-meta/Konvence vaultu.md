---
type: meta
status: active
aliases:
  - Konvence
  - Pravidla vaultu
tags:
  - meta
created: 2026-10-12
updated: 2026-10-12
---
# Konvence vaultu

Jediný zdroj pravdy o tom, jak je vault uspořádaný a jak se vede. Platí stejně pro Pavla i pro Clauda. Principy vychází z ověřených postupů (PARA, Zettelkasten, MOC + Bases), zdroje jsou v [[Second brain v Obsidianu]].

Vault je složka `docs/` v repozitáři tinycad. V Obsidianu se otevírá **jen `docs/`**, ne celý repozitář.

## Principy

1. **Složky jsou úložiště, odkazy jsou význam.** Složka říká, *jaký typ* poznámky to je. Souvislosti tvoří wikilinky a vlastnosti.
2. **Jedna myšlenka na poznámku.** Pojmy, otázky a poznatky jsou atomické. Specifikace a milníky jsou větší strukturální dokumenty.
3. **Konzistentní vlastnosti.** Každá poznámka má frontmatter podle schématu níže. Díky tomu fungují Bases a Claude ve vaultu rychle najde, co hledá.
4. **Ručně kurátorovaná mapa + automatické přehledy.** MOC poznámky ([[Domů]], [[Glosář]], [[Rozhodnutí]], [[Roadmapa]]) mají nahoře ručně psaný kontext a pod ním vložené Bases.
5. **Stav je na jednom místě.** Stav milníku, otázky nebo specifikace je jen ve vlastnosti `status` dané poznámky, nikde se neopisuje ručně.
6. **Nudné, předvídatelné názvy** u strukturálních dokumentů (`07-regenerace`, `M06-regenerace`, `0004-...`), přirozené názvy u atomických poznámek (`Rollback bar`, `Q012 Volba WASM buildu OCCT`).

## Struktura

| Složka | Obsah | Typ (`type`) |
|---|---|---|
| `Domů.md` | vstupní bod, hlavní MOC | `moc` |
| `00-meta/` | tyto konvence, `sablony/`, `bases/`, `prilohy/` | `meta` |
| `01-inbox/` | rychlé nápady k roztřídění | `note` |
| `10-vize/` | vize a rozsah projektu | `moc` |
| `20-spec/` | specifikace modulů (zamýšlený stav) | `spec` |
| `30-adr/` | architektonická rozhodnutí + rozcestník [[Rozhodnutí]] | `adr` |
| `40-plan/` | [[Roadmapa]] a milníky | `milestone` |
| `50-pojmy/` | atomické pojmy + rozcestník [[Glosář]] | `concept` |
| `60-otazky/` | otevřené a rozhodnuté otázky | `question` |
| `70-poznatky/` | co jsem se naučil (rešerše, principy, srovnání) | `insight` |
| `80-denik/` | deník změn, jeden soubor na den `RRRR-MM-DD.md` | `log` |
| `90-archiv/` | neaktivní poznámky (nic se nemaže, jen archivuje) | původní |

Číselné prefixy drží pevné pořadí složek v průzkumníku. Nová složka smí vzniknout jen úpravou této tabulky.

## Vlastnosti (frontmatter)

**Společné pro všechny poznámky:** `type`, `status` (kde dává smysl), `aliases`, `tags`, `created`, `updated` (formát `RRRR-MM-DD`). Při každé obsahové úpravě se aktualizuje `updated`.

Hodnoty vlastností jsou anglické a krátké (strojově stabilní), text poznámek je česky. Odkazy ve vlastnostech se píšou v uvozovkách: `"[[07-regenerace]]"`.

| Typ | Další vlastnosti | Hodnoty `status` |
|---|---|---|
| `spec` | `order`, `modules`, `milestones` | `outline` → `draft` → `accepted` → `implemented` |
| `adr` | `number`, `date`, `related`, `supersedes` | `proposed` → `accepted` → `superseded` |
| `milestone` | `order`, `modules`, `specs`, `depends_on`, `started`, `finished` | `todo` → `doing` → `done` |
| `concept` | `code` (název v kódu), `module`, `summary` (jedna věta), `related` | (bez stavu) |
| `question` | `area` (spec), `decide_by` (milník), `proposal` (krátce), `decision` | `open` → `answered` / `dropped` |
| `insight` | `topics`, `sources` | `seed` (surový) → `evergreen` (zpracovaný) |
| `log` | `date`, `summary`, `milestones` | (bez stavu) |
| `moc`, `meta` | – | `active` |

Typy vlastností (datum, číslo, seznam) jsou nastavené v `.obsidian/types.json`.

## Odkazy

- Interní odkazy jsou vždy **wikilinky** `[[poznámka]]`, s aliasem `[[07-regenerace|regenerace]]`, na nadpis `[[01-architektura#Adresářová struktura]]`.
- V tabulkách se svislítko v aliasu escapuje: `[[M01-core\|M1]]`.
- **Pojem se prolinkuje při první zmínce** v poznámce, např. „[[Rollback bar|rollback bar]]“. Další zmínky už ne.
- **Pravidlo dvou odkazů:** každá nová poznámka odkazuje aspoň na dvě existující (obvykle na specifikaci a pojem). Osamocená poznámka se v grafu ztratí.
- Specifikace mají pod nadpisem řádek *Pojmy / Rozhodnutí / Milník*: rychlá navigace pro člověka i Clauda.
- Bases se vkládají jako `![[otazky.base#Název pohledu]]`. Pohledy „… k této poznámce“ filtrují přes `file.hasLink(this.file)`, takže fungují v jakékoli poznámce.

## Typy poznámek v praxi

### Specifikace
Popisuje **zamýšlený stav**. Když se kód odchýlí, opraví se specifikace ve stejném kroku. Otevřené otázky nejsou v textu specifikace, ale jako samostatné poznámky v `60-otazky/` (vložené přes Bases na konci specifikace).

### Otázky
Každá nejasnost v návrhu = jedna poznámka `Qnnn Krátký název` (šablona *Otázka*). Vlastnost `area` ukazuje na specifikaci, `decide_by` na milník, do kterého se musí rozhodnout. Po rozhodnutí: vyplnit sekci *Rozhodnutí*, `status: answered`, `decision`, propsat do specifikace. Zásadní rozhodnutí se navíc zapíše jako ADR.

### Rozhodnutí (ADR)
Viz pravidla v [[Rozhodnutí]]. ADR se nepřepisují, nahrazují se.

### Pojmy
Atomická definice v 2–6 větách, `code` = název v kódu, odkazy na specifikace. Když se změní název v kódu, mění se `code` a případně `aliases`, nikdy se pojem nezakládá znovu.

### Poznatky
Obecné znalosti, které přežijí tinycad: rešerše (geometrická jádra, Onshape), principy, „co bych příště udělal jinak“. Vždy se zdroji. Nový poznatek začíná jako `seed`; když je přepsaný vlastními slovy a propojený, je `evergreen`. Typicky vznikají z retrospektivy milníku.

### Deník
Jeden soubor na den (`80-denik/2026-10-12.md`, šablona *Deník*, nebo přes Daily notes). Krátce: co se změnilo (s odkazy), co se rozhodlo, co je další krok. Je to faktický záznam, ne úvaha. Deník nahrazuje changelog.

## Inbox a revize

- Rychlý nápad bez rozmyslu → `01-inbox/` (šablona *Poznámka*). Žádné vlastnosti kromě `type: note` nejsou povinné.
- **Po každém pracovním sezení:** záznam v deníku, `updated` u změněných poznámek.
- **Na konci milníku:** retrospektiva v milníku, poznatky do `70-poznatky/`, projít otevřené otázky s `decide_by` na další milník, inbox vyprázdnit (každá poznámka se buď zpracuje do správné složky, nebo archivuje).
- **Jednou za měsíc (nebo po 3 milnících):** projít [[Domů]] a MOC: sedí mapa architektury? Nejsou v grafu osamocené poznámky? Neopakují se tagy, které by měly být vlastností?

## Pravidla pro Clauda

Nejdůležitější nahoře.

1. Vault je zdroj pravdy o návrhu. Před prací na milníku si přečti milník, odkazované specifikace a otevřené otázky s `decide_by` na tento milník.
2. Neměň strukturu složek ani schéma vlastností bez dohody. Změna = úprava této poznámky.
3. Po každém sezení zapiš nebo doplň dnešní záznam v `80-denik/` a aktualizuj `updated` u změněných poznámek.
4. Stav (`status`, `started`, `finished`) měň jen ve vlastnostech, nikdy ho neopisuj do textu nebo tabulek.
5. Nejasnost v návrhu → nová poznámka v `60-otazky/`, ne poznámka v textu. Zeptej se Pavla, nerozhoduj potichu.
6. Nové pojmy zakládej v `50-pojmy/` a prolinkuj při první zmínce. Žádné duplicitní pojmy, nejdřív hledej podle `aliases`.
7. Pavlovy poznámky v `01-inbox/` a jeho vlastní text v poznámkách nepřepisuj. Navrhni změnu, nebo doplň pod něj.
8. Používej šablony z `00-meta/sablony/` (zástupné `{{date}}` a `{{title}}` nahraď skutečnými hodnotami).
9. Nic nemaž. Nepotřebné přesuň do `90-archiv/`.

## Nastavení Obsidianu

- Vault: složka `docs/`. Konfigurace v `docs/.obsidian/` je v gitu, kromě `workspace*.json`.
- Zapnuté core pluginy: **Bases**, **Templates** (složka `00-meta/sablony`), **Daily notes** (složka `80-denik`, formát `YYYY-MM-DD`, šablona `00-meta/sablony/Deník`), **Backlinks**, **Graph view**.
- Odkazy: wikilinky, nejkratší možná cesta, automatická aktualizace odkazů při přejmenování.
- Nové poznámky vznikají v `01-inbox/`, přílohy v `00-meta/prilohy/`.
- Volitelně plugin **Obsidian Git** pro automatické commity.
