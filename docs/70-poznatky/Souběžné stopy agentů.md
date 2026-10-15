---
type: insight
status: seed
aliases:
  - Metodika souběžných stop
  - Souběžné stopy
topics:
  - metodika
  - agenti
  - git worktree
sources:
  - "[[Roadmapa#Souběžné stopy (pokus od M25)]]"
  - "[[2026-10-15]]"
  - "[[Q087 Spline v řešiči a v jádře – zjištění z implementace]]"
tags:
  - poznatek
created: 2026-10-15
updated: 2026-10-15
---
# Souběžné stopy agentů

**Shrnutí:** víc agentů může implementovat milníky najednou, když se práce rozdělí podle **průniku dotčených souborů**, ne podle pořadí. Kontrakty sdílených typů se zafixují předem v hlavním sezení a slučuje se po jednom.

## Podrobnosti

### Kdy to dává smysl

- Série několika milníků, které se dají rozdělit do skupin, jež sahají do různých souborů nebo vrstev.
- Návrh je hotový natolik, že jde předem napsat kontrakt: signatury, tvary dat, krajní případy a seznam testů.
- Nedává smysl pro milníky, které staví jeden na druhém ve stejném souboru. Ty patří do jedné stopy za sebou.

### Postup

1. **Mapa souborů.** U každého milníku série vypiš soubory a moduly, které změní (tabulka milník × soubor). Stopa = skupina milníků s malým průnikem souborů s ostatními skupinami. Uvnitř stopy jdou milníky za sebou.
2. **Hlavní sezení připraví vše, co je sdílené:**
   - rozhodne otevřené otázky (s člověkem, ne potichu);
   - zafixuje kontrakty **sdílených typů**, typicky členy unií (např. `SketchConstraint`), aby každá stopa jen přidávala své členy a větve `switch`;
   - napíše implementační plány a do `depends_on` zapíše jen skutečné závislosti, ne pořadí z dřívějšího sekvenčního plánu;
   - commitne to do `main`. Tento commit je výchozí bod všech stop.
3. **Spuštění:** jedna session na stopu, každá ve vlastním git worktree. Brief obsahuje: co přečíst, pravidla stop, souběžné stopy a jejich soubory, „hotovo když“ a jak hlásit stav.
4. **Pravidla stop:**
   - Ve vaultu mění jen svůj milník a svou sekci spec. Deník nepíše; průběh zapisuje do sekce *Průběh stopy* v milníku.
   - Novou otázku čísluje až po kontrole posledního čísla v `main` a hned ji hlásí hlavnímu sezení.
   - Na poznámku, která existuje jen v jiné větvi, neodkazuje wikilinkem (neprošel by `lint:vault`), ale textem. Wikilink doplní hlavní sezení při sloučení.
   - Commituje na svou větev a do `main` neslučuje.
5. **Hlavní sezení je dispečer:**
   - otázky stop předává člověku a jeho rozhodnutí posílá zpět s doslovnou citací;
   - v každé odpovědi shrne **úplný stav** rozhodnutí, protože zprávy se můžou zkřížit (stopa se zeptá znovu dřív, než jí dorazí odpověď);
   - slučuje po jednom: zkontroluje diff proti kontraktu, spustí `npm run check` a e2e, průběh stopy přenese do deníku a doplní wikilinky;
   - stopu, která čeká na jinou (např. nástroje nad snapperem), pozdrží a pustí ji až po sloučení té druhé.
6. **Přehled pro člověka:** stav se bere z gitu a z vaultu, ne z paměti agenta. V tinycad to dělá panel `/stopy` (mod Claude Code v `.claude/skills/tinycad-stopy/`): worktree, commity navíc, rozpracované soubory, milníky podle `status`, zaškrtnuté úkoly a `depends_on`.

### Co se zatím ukázalo (série M25–M29, 2026-10-15)

- Stopa ve spodních vrstvách (`core`, `kernel`, oblasti) se sloučila **bez jediného konfliktu** (37 souborů, ~3 650 řádků).
- Kontrakt psaný předem udělal z rozporu s realitou konkrétní otázku: planegcs se choval jinak, než předpokládal kontrakt ([[Q087 Spline v řešiči a v jádře – zjištění z implementace|Q087]]). Bez kontraktu by se rozpor ukázal až jako záhadná chyba při slučování.
- Chyba v kontraktu (matematika B-spline v modulu, na kterém `kernel` nesmí záviset) se ukázala hned. Kontrola hranic modulů funguje jako pojistka i pro souběžnou práci.
- Člověk rychle ztratí přehled o tom, co je hotové, co čeká a na co. Proto vznikl panel stavu.
- `depends_on` zděděné ze sekvenčního plánu lže o souběhu a musí se opravit.

### Otevřené

- Vyplatí se to? Zhodnotit na konci série: čas proti sekvenční práci, počet a velikost konfliktů, kvalita (revize, chyby po sloučení).
- Má z metodiky vzniknout skill (start stop, sloučení stopy)? Rozhodnout po druhém použití.

## Jak to využívá tinycad

Pravidla série M25–M29 jsou v [[Roadmapa#Souběžné stopy (pokus od M25)]]. Kontrakty předem stojí na tom, že tinycad má hranice modulů hlídané nástrojem ([[01-architektura]]) a spec jako zdroj pravdy. Postup navazuje na rozdělení specifikace a implementace z `CLAUDE.md` (hlavní sezení rozhoduje, subagent `implementer` implementuje), jen o úroveň výš: místo úkolů souběžně běží celé milníky.

## Zdroje

- [[Roadmapa#Souběžné stopy (pokus od M25)]] – pravidla stop první série
- [[2026-10-15]] – průběh a sloučení stopy C
- [[M29-spliny#Průběh stopy]] – záznam stopy C
