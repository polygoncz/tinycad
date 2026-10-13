---
name: obsidian-format
description: Syntaxe a formát Obsidianu pro vault tinycad v docs/ – wikilinky, aliasy, odkazy v tabulkách, embedy Bases, frontmatter a soubory .base. Použij před každou úpravou nebo vytvořením souboru v docs/.
user-invocable: false
---

# Formát Obsidianu ve vaultu `docs/`

Pravidla obsahu jsou v `docs/00-meta/Konvence vaultu.md`. Tady je jen **syntaxe**, aby se vault v Obsidianu správně zobrazoval.

## Odkazy
- Interní odkaz je vždy wikilink na název souboru bez přípony: `[[07-regenerace]]`. Nikdy markdown odkaz `[x](soubor.md)`.
- Alias: `[[07-regenerace|regenerace]]`. Nadpis: `[[01-architektura#Adresářová struktura]]`. Obojí: `[[01-architektura#Principy|principy]]`.
- **V tabulce** se svislítko escapuje: `[[M01-core\|M1]]`. Jinak se rozbije sloupec.
- Ve frontmatteru jsou odkazy v uvozovkách: `area: "[[07-regenerace]]"`. Seznam:
  ```yaml
  related:
    - "[[01-architektura]]"
  ```
- Názvy souborů s diakritikou a mezerami jsou v pořádku (`[[Q012 Volba WASM buildu OCCT]]`). Odkaz musí přesně odpovídat názvu souboru.
- Wikilinky uvnitř `inline kódu` a bloků kódu se nevykreslují. Tak se dají ukázat jako příklad.

## Embedy
- Vložení pohledu Bases: `![[otazky.base#Otázky k této poznámce]]`. Za `#` je `name` pohledu z `.base` souboru.
- Bases jsou v `docs/00-meta/bases/*.base` (YAML): `filters` (`and`/`or`, výrazy jako `file.inFolder("60-otazky")`, `note.status == "open"`, `file.hasLink(this.file)`), `properties` (`displayName`) a `views` (`type: table`, `name`, `filters`, `order`, `sort`, `groupBy`).
- `note.<vlastnost>` čte frontmatter, `file.*` metadata souboru, `this.file` je poznámka, do které je base vložená.
- Nový pohled přidej do existujícího `.base` souboru. Nový `.base` soubor jen po dohodě.

## Frontmatter
- Blok `---` na prvním řádku. Klíče malými písmeny, anglicky. Data `RRRR-MM-DD` bez uvozovek.
- Typy vlastností jsou v `docs/.obsidian/types.json`. Nová vlastnost = úprava Konvencí a `types.json`, jen po dohodě.
- Prázdný seznam `[]`, prázdná hodnota prostě `klic:` bez hodnoty (např. `started:`).
- `tags` bez `#`.

## Ostatní
- Callouty: `> [!note]`, `> [!warning] Titulek`.
- Úkoly: `- [ ]` / `- [x]`, v milnících se zaškrtávají.
- Přílohy patří do `docs/00-meta/prilohy/`, vkládají se `![[obrazek.png]]`.
- Konfiguraci `docs/.obsidian/` neupravuj bez dohody.
