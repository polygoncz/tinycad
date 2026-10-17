---
type: insight
status: evergreen
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
   - **Před ohlášením k sloučení si natáhne `main`** a konflikty vyřeší sama (od série M30–M37): sloučení do `main` je pak bez konfliktů a dispečer jen ověřuje. Když větev obsahuje už i commity dalšího milníku, ohlásí ref uzavření milníku.
5. **Hlavní sezení je dispečer:**
   - otázky stop předává člověku a jeho rozhodnutí posílá zpět s doslovnou citací;
   - v každé odpovědi shrne **úplný stav** rozhodnutí, protože zprávy se můžou zkřížit (stopa se zeptá znovu dřív, než jí dorazí odpověď);
   - slučuje po jednom: zkontroluje diff proti kontraktu, spustí `npm run check` a e2e, průběh stopy přenese do deníku a doplní wikilinky;
   - stopu, která čeká na jinou (např. nástroje nad snapperem), pozdrží a pustí ji až po sloučení té druhé;
   - **hlavní checkout patří jen jemu** (od série M30–M37): jiná práce – i drobná vylepšení, která člověk chce dělat souběžně se stopami – běží ve vlastní session ve vlastním worktree a do `main` ji slučuje dispečer stejně jako stopu. Dvě session v jednom checkoutu sdílejí index i `MERGE_HEAD`: commit jedné „dokončí“ rozjeté sloučení druhé a souběžné e2e si mažou `test-results`.
6. **Zkoušení výsledku:** dev server běží nad hlavním checkoutem (tedy nad `main`) a po každém sloučení se obnoví; hlášení o sloučení končí krátkým „co zkusit“ (nástroj, gesto). Člověk zkouší jen to, co je v `main`, ne rozpracované větve.
7. **Přehled pro člověka:** stav se bere z gitu a z vaultu, ne z paměti agenta. V tinycad to dělá panel `/stopy` (mod Claude Code v `.claude/skills/tinycad-stopy/`): worktree, commity navíc, rozpracované soubory, milníky podle `status`, zaškrtnuté úkoly a `depends_on`.

### Zhodnocení první série (M25–M29, 2026-10-15 a 16)

**Verdikt (Pavel):** vyplatilo se, pokračovat. Nejtěžší pro člověka byla **ztráta přehledu**.

| Měřítko | Výsledek |
|---|---|
| Čas | plán v `main` 18:32; do 20:42 sloučené M29 (úkoly 1–7), M28, M25, M26 – 4½ milníku za ~2 h 10 min; M27 hotový 21:45, úkol 8 M29 (čekal na M26) ráno. Den předtím sekvenčně ~1–2 h na milník → **zhruba dvojnásobné zrychlení**. |
| Konflikty | stopa C (spodní vrstvy) 0; stopa B 3 textové + 1 skrytý (testovací pomůcka neznala novou variantu kresby); stopa A při natažení `main` 23 textových v 17 souborech + 3 sémantické. Všechny sémantické našel `strict` TypeScript s vyčerpávajícími `switch`. |
| Kvalita | žádná regrese po sloučení; e2e 104 → 136; architektonické revize každé stopy bez závažných porušení. Jediná skrytá chyba (zahozená tečnost ve sdíleném bodě, z M26) se našla v M27 a se souběhem nesouvisí. |
| Kontrakty | dvakrát narazily na realitu (planegcs, hranice modulů B-spline) a pokaždé z toho byla konkrétní otázka ([[Q087 Spline v řešiči a v jádře – zjištění z implementace\|Q087]]), ne záhada při slučování. |
| Režie člověka | 6 otázek ve vaultu, přes 20 rozhodnutí stop (A7–A26), zkřížené zprávy, nutnost panelu stavu. |

**Co se osvědčilo:**
- Rozdělení podle průniku souborů: stopa ve spodních vrstvách (`core`, `kernel`, oblasti) se sloučila bez konfliktu; stopa v nejvíc sdíleném souboru (`sketch-session.ts`) jela sekvenčně a konflikty si řešila sama při natažení `main`.
- Kontrakty sdílených typů předem: konflikty v uniích a `switch` byly sčítací a mechanické.
- Typová kontrola jako detektor sémantických konfliktů – po každém sloučení celý `npm run check`, ne jen vyřešené konflikty.
- Stopy si samy paralelizovaly úkoly (stopa A přes izolované worktree implementátorů, B a C ve sdíleném worktree s disjunktními soubory).
- Panel stavu z gitu a vaultu (`/stopy`) – přehled bez spoléhání na paměť agenta.

**Co zlepšit:**
- **Přehled pro člověka je hlavní úzké hrdlo.** Panel spustit hned se stopami, ne až když se člověk ztratí; hlavní sezení má hlásit stav krátce a vždy ve stejném tvaru.
- Zprávy se kříží: odpověď vždy s úplným stavem rozhodnutí a se jménem otázky.
- `depends_on` ze sekvenčního plánu opravit hned při rozdělení do stop.
- Sdílený `npm run check` ve worktree s více implementátory padá na rozpracovaných souborech sousedů – buď izolované worktree implementátorů (jako stopa A), nebo počkat.
- Úkol, který čeká na jinou stopu (nástroje splinu na snapperu), rozdělit už v plánu a hlídat v panelu.
- Primitiva cizí knihovny ověřit prototypem před kontraktem ([[Primitivum knihovny ověř prototypem před kontraktem]]).

### Zhodnocení druhé série (M30–M37, 2026-10-16 a 17)

**Verdikt (Pavel):** „v pohodě“, pokračovat. Nejtěžší: **přehled o stavu** a **zkoušení výsledku**. Přání: moci souběžně se stopami dělat drobná vylepšení (z toho pravidlo o hlavním checkoutu výše).

| Měřítko | Výsledek |
|---|---|
| Čas | plán 16. 10. 18:02, stopy od 18:23; do 00:51 sloučeno 6 milníků, ráno M37 a M35 – **8 milníků za ~6½ h práce**. Tři stopy: A (M30, M33–M35), B (M31, M32), C (M36, M37). |
| Rozsah | ~205 commitů ve stopách; unit testy 6508 → 8071, integrační 39 → 44, e2e 136 → 186. |
| Konflikty | M30, M31, M32, M34, M35 bez konfliktu (stopa měla natažený `main`); M36 25 souborů + 4 sémantické, M33 5 + sémantické, M37 4 + sémantické – řešil dispečer. |
| Kvalita | žádná regrese po sloučení; e2e po každém sloučení zelené (jednou až po opravě lišty). |

**Co typecheck nechytil** (tři nové druhy sémantických konfliktů):
- **Sdílený prostředek UI** – šířka lišty skicáře: každá stopa se vešla sama, dohromady ne; dvakrát to odhalilo až e2e (*Kóta* v „…“). Řešení Pavlem: bod a text do rodiny úsečky, všechny úpravy jedna rodina. Zjištění: kontrakty předem fixovaly typy, ne prostor v liště.
- **Zdvojené pravidlo** – lokální `kind !== 'point'` v nástrojích (`curve-pick.ts`, zaoblení) nová entita tiše prošla; vyčerpávající `switch` ano. Našla to architektonická revize stopy, ne typy. Zjištění: pravidla typu „co je křivka“ patří na jedno místo doménového modulu (`isCurveEntity`).
- **Sdílený pracovní strom** – jiná session v hlavním checkoutu commitnula během dispečerova rozjetého sloučení (M35 skončil ve slučovacím commitu s cizí zprávou) a souběžné e2e si mazaly `test-results`. Z toho pravidlo „hlavní checkout jen dispečer“.

**Co se osvědčilo:** kontrakty sdílených typů předem (tabulka „kdo přidává co“); prototyp primitiv cizí knihovny před implementací (OCCT v M30, M34, M35 – pokaždé změnil plán); stopy, které si natáhly `main` samy (sloučení bez konfliktu); závislost mezi stopami oddělená už v plánu (M36 úkol 5 čekal na M30); dev server nad `main` pro zkoušení mezi sloučeními (Pavel díky tomu našel UX slabinu nástrojů polí → HUD nápověda).

**Co zlepšit:** přehled a zkoušení – hlášení po sloučení s „co zkusit“; drobná vylepšení ve vlastní session; u nových nástrojů myslet na místo v liště při psaní kontraktu.

### Opakovatelnost

Postup je od 2026-10-16 i skill `/stopa start|sloucit` (`.claude/skills/stopa/`).

## Jak to využívá tinycad

Pravidla série M25–M29 jsou v [[Roadmapa#Souběžné stopy (pokus od M25)]]. Kontrakty předem stojí na tom, že tinycad má hranice modulů hlídané nástrojem ([[01-architektura]]) a spec jako zdroj pravdy. Postup navazuje na rozdělení specifikace a implementace z `CLAUDE.md` (hlavní sezení rozhoduje, subagent `implementer` implementuje), jen o úroveň výš: místo úkolů souběžně běží celé milníky.

## Zdroje

- [[Roadmapa#Souběžné stopy (pokus od M25)]] – pravidla stop první série
- [[2026-10-15]] – průběh a sloučení stopy C
- [[M29-spliny#Průběh stopy]] – záznam stopy C
