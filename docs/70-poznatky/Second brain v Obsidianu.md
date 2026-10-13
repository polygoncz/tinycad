---
type: insight
status: seed
aliases:
  - Second brain
  - Jak vést vault
topics:
  - Obsidian
  - PKM
sources:
  - https://kennethreitz.org/essays/2026-03-06-obsidian_vaults_and_claude_code
  - https://okhlopkov.com/second-brain-obsidian-claude-code/
  - https://skills.cat/skills/kriscard/kriscard-claude-plugins/obsidian-workflows-second-brain-methodology
  - https://lr.in.psf.lt/r/ObsidianMD/comments/1lhqxn6/is_base_the_new_moc
  - https://obsidian.md/help/bases/syntax
tags:
  - poznatek
created: 2026-10-12
updated: 2026-10-12
---
# Second brain v Obsidianu

**Shrnutí:** složky slouží jako úložiště podle typu, význam nesou odkazy a konzistentní vlastnosti; ručně psané MOC poznámky s vloženými Bases dávají kontext i automatické přehledy; agent (Claude) potřebuje jasná pravidla v jednom souboru a předvídatelné cesty.

## Co jsem převzal a proč

- **Číslované složky** (`00-meta`, `10-…`): pevné pořadí v průzkumníku; meta, šablony a pravidla v jedné meta složce. *(Reitz)*
- **PARA přizpůsobené práci:** PARA (Projects/Areas/Resources/Archive) třídí podle akčnosti. Vault jednoho projektu jsem přizpůsobil typům dokumentů; z PARA zůstal inbox, poznatky (Resources) a archiv. *(Reitz, skills.cat)*
- **„Links create meaning, folders create storage.“** Atomické poznámky (jedna myšlenka), pravidlo dvou odkazů pro novou poznámku, odkazy přednostně před tagy. *(skills.cat)*
- **Minimální povinné vlastnosti** (`type`, `status`, datum) a konzistentní schéma, aby šly dotazovat. *(Reitz)*
- **MOC + Bases hybrid:** ruční kurátorovaná část nahoře, vložená Base pod ní; Bases nejlépe fungují na strukturovaných poznámkách s vlastnostmi. *(Reddit r/ObsidianMD)*
- **Pravidla pro agenta v jednom souboru**, nejdůležitější nahoře, krátce; zdroj pravdy definovaný explicitně; nepřepisovat lidské poznámky; „nudné“ názvy a předvídatelné cesty. *(okhlopkov, Reitz)*
- **Deník jako faktický záznam** s jednotnou strukturou ze šablony. *(Reitz)*
- **Revize v rytmu:** inbox zpracovat pravidelně, MOC aktualizovat, archivovat hotové. Rytmus jsem navázal na milníky místo kalendáře. *(skills.cat)*
- **Git:** vault verzovat, volitelně Obsidian Git. „Claude navrhuje, ty rozhoduješ.“ *(Reitz)*
- **Bases syntaxe:** globální `filters` + pohledy, `file.hasLink(this.file)` pro vložené pohledy k aktuální poznámce. *(Obsidian Help)*

## Jak to využívá tinycad

Pravidla jsou v [[Konvence vaultu]], vstupní bod je [[Domů]].

## Zdroje

- [Kenneth Reitz – Obsidian vaults and Claude Code](https://kennethreitz.org/essays/2026-03-06-obsidian_vaults_and_claude_code)
- [Okhlopkov – Obsidian Second Brain with Claude Code](https://okhlopkov.com/second-brain-obsidian-claude-code/)
- [Second brain methodology (skills.cat)](https://skills.cat/skills/kriscard/kriscard-claude-plugins/obsidian-workflows-second-brain-methodology)
- [r/ObsidianMD – Is Base the new MOC?](https://lr.in.psf.lt/r/ObsidianMD/comments/1lhqxn6/is_base_the_new_moc)
- [Obsidian Help – Bases syntax](https://obsidian.md/help/bases/syntax)
