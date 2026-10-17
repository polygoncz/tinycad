---
type: moc
status: active
aliases:
  - Plán
  - Roadmap
tags:
  - plan
created: 2026-10-12
updated: 2026-10-17
---
# Roadmapa

Stavíme **odspodu nahoru**: nejdřív vrstvy bez závislostí, každá hotová a otestovaná, než na ní postavíme další. Prvních sedm milníků (M0–M6) běží celé v Node bez prohlížeče a bez OCCT – ověřujeme na nich architekturu. Od M7 přibývá skutečná geometrie, od M8 obraz a v M10 je první použitelná aplikace.

Jediná entita až do M10 je **kvádr (Box)**. Druhá entita v M11 je zkouška rozšiřitelnosti.

## Přehled

| Milník | Název | Moduly | Výsledek |
|---|---|---|---|
| [[M00-zaklad-projektu\|M0]] | Základ projektu | – | Vite + TS + Vue + Vitest + lint, kontrola hranic modulů |
| [[M01-core\|M1]] | Core | `core` | ID, události, Disposable, Result, matematika, RPC |
| [[M02-dokument\|M2]] | Doménový model | `document` | CadDocument, featury, schémata, serializace |
| [[M03-operace\|M3]] | Operace a historie | `ops` | dispečer, log, transakce, undo/redo, replay test |
| [[M04-persistence\|M4]] | Persistence | `persistence` | IndexedDB ve workeru, snapshoty, načtení |
| [[M05-kernel-port\|M5]] | Port jádra | `kernel` | `GeometryKernel`, `FakeKernel`, kontraktové testy |
| [[M06-regenerace\|M6]] | Regenerace | `regen`, `plugin-api`, `features/box` | Regenerator s cache, rollback, chyby, Box plugin |
| [[M07-kernel-occt\|M7]] | OCCT adaptér | `kernel-occt` | skutečné OCCT ve workeru, tessellace |
| [[M08-vykreslovani\|M8]] | Vykreslování | `render` | viewport, synchronizace, picking |
| [[M09-interakce\|M9]] | Interakce | `interaction` | výběr, nástroje, dialog featury, akce |
| [[M10-ui\|M10]] | UI a první aplikace | `app`, `ui` | **spustitelná aplikace s kvádrem**, strom, dialog, undo, ukládání |
| [[M10.1-zpevneni-kostry\|M10.1]] | Zpevnění kostry | `document`, `ops`, `regen`, `interaction`, `render`, `app` | opravy z [[Revize architektury 2026-10-13\|revize architektury]]: artefakty, identita tělesa, reference, migrace v logu, filtr pickingu |
| [[M11-dalsi-entity\|M11]] | Další entity | `features/*` | Cylinder, Transform, Boolean; reference na tělesa |
| [[M12-skicar\|M12]] | Skicář | `features/sketch` | skica, vazby (planegcs), profily |
| [[M13-extrude-revolve\|M13]] | Extrude a Revolve | `features/*` | tělesa ze skici |
| [[M14-topologicke-pojmenovani\|M14]] | Topologické pojmenování | `regen`, `kernel-occt` | fillet, chamfer, skica na ploše, stabilní reference |
| [[M15-export-a-dokonceni\|M15]] | Export a dokončení | `kernel-occt`, `ui` | STEP export, import/export dokumentu |
| [[M16-vlastni-occt-build\|M16]] | Vlastní OCCT build | `kernel-occt` | ~~vlastní C++ modul přes Emscripten~~ – archivováno 2026-10-17, nahradila ho série nativního jádra ([[0030-nativni-jadro-pres-grpc\|ADR 0030]]) |
| [[M17-kamera-a-view-cube\|M17]] | Kamera a view cube | `core`, `render`, `app`, `ui` | kamera bez ořezávání, vlastní ovládání, view cube jako v Onshape |
| [[M17.1-rezim-otaceni\|M17.1]] | Režim otáčení | `render`, `app`, `ui` | turntable (Z nahoru) jako výchozí, volná rotace přepínatelná u view cube |
| [[M18-manipulatory\|M18]] | Manipulátory | `regen`, `interaction`, `plugin-api`, `render`, `app`, `ui`, `features/*` | úchyty ve viewportu: posun a rotace Transformace, vzdálenost Extrude; obecná abstrakce přes kotvy z regenerace ([[0021-manipulatory-kotvy-z-regenerace\|ADR 0021]]) |
| [[M19-manipulator-fusion\|M19]] | Manipulátor ve stylu Fusion | `interaction`, `render`, `app`, `ui`, `features/*` | šipky, čtverce, oblouky a střed; lišta režimů (Volný, Posun, Rotace, Nastavit pivot), pole hodnoty; rotace jako tři úhly ([[0022-rezimy-a-hud-manipulatoru\|ADR 0022]]) |
| [[M19.1-opravy-z-revize\|M19.1]] | Opravy z revize kódu | `core`, `ops`, `document`, `persistence`, `kernel-occt`, `interaction`, `app`, `ui`, `features/*` | ověřené chyby z [[Revize kódu 2026-10-14\|revize kódu]] (menu, rollback bar, validace zápisu, pád jádra, výjimky OCCT) a viditelné chyby v UI |
| [[M19.2-ux-backlog\|M19.2]] | UX backlog | `render`, `interaction`, `persistence`, `app`, `ui`, `features/*` | barva výběru, skica zakrytá tělesy, kóty ve viewportu, přejmenování dokumentu, klávesnice, kontrast, přetečení timeline |
| [[M20-zpevneni-struktury\|M20]] | Zpevnění struktury | `document`, `regen`, `plugin-api`, `interaction`, `render`, `app`, `ui`, `features/*` | dluh z [[Revize kódu 2026-10-14\|revize kódu]] A2–A6, A8, A9: úzká rozhraní, kontrakty v typech, tabulka druhů referencí, rozdělení session, modul `sketcher`, `evaluateParams` |
| [[M21-vstupni-stav-editovane-featury\|M21]] | Vstupní stav editované featury | `regen`, `interaction`, `render`, `app` | výběr a zvýraznění nad vstupem editované featury, náhled zvlášť ([[Q075 Vstupní stav editované featury\|Q075]]) |
| [[M22-rezimy-zobrazeni\|M22]] | Režimy zobrazení | `render`, `app`, `ui` | Shaded (hrany, průhlednost), Hidden lines removed/visible, Wireframe, přepínač triangulace; výběr „co vidíš, to vybereš“ ([[Styl zobrazení]]) |
| [[M23-postprocessing-a-ao\|M23]] | Postprocessing a AO | `render`, `app`, `ui` | víceprůchodové vykreslování, ambient occlusion ([[Q077 Technika AO\|Q077]]) |
| [[M24-realisticke-zobrazeni\|M24]] | Realistické zobrazení | `document`, `ops`, `persistence`, `interaction`, `render`, `app`, `ui` | režim Realistic: PBR, environment mapa, tone mapping, kontaktní stín; materiál tělesa v dokumentu ([[Q078 Sada materiálů těles\|Q078]]) |
| [[M25-glyfy-vazeb\|M25]] | Glyfy vazeb | `sketch`, `sketcher`, `interaction`, `render`, `ui` | vazby jako značky u entit ve viewportu, výběr a mazání glyfu; seznam vazeb v panelu sbalený |
| [[M26-snapper-a-auto-vazby\|M26]] | Snapper a auto-vazby | `sketch`, `solver-planegcs`, `sketcher`, `render` | přichycení ke geometrii a vodítka, automatické vazby při kreslení, nové vazby `pointOnCurve`, `midpoint`, zarovnání |
| [[M27-oblouky-a-kruznice\|M27]] | Oblouky a kružnice | `sketch`, `sketcher`, `ui` | kružnice 2 body, 3 body, 2 a 3 tečny; oblouk 3 body a tečný; tečný oblouk v polyline |
| [[M28-koty\|M28]] | Kóty | `sketch`, `solver-planegcs`, `features/*`, `sketcher`, `render`, `ui` | jeden nástroj Kóta s druhem podle polohy myši, nové druhy (vodorovná, svislá, úhel, průměr…), přetahování a uložená poloha |
| [[M29-spliny\|M29]] | Spliny | `sketch`, `solver-planegcs`, `features/*`, `kernel`, `kernel-occt`, `sketcher`, `render` | kubický B-spline přes řídicí body (NURBS) a přes body, oblasti a vysunutí |
| [[M30-geometrie-skici-v-occt\|M30]] | Geometrie skici v OCCT | `kernel`, `kernel-occt`, `sketch`, `features/*`, `regen`, `interaction`, `sketcher`, `app` | oblasti, křížení a průsečíky skici počítá jádro ([[0028-geometrie-skici-v-jadre\|ADR 0028]]) |
| [[M31-nove-kreslici-nastroje\|M31]] | Nové kreslicí nástroje | `sketch`, `solver-planegcs`, `sketcher`, `render`, `ui` | obdélník středem a třemi body, bod, drážky, režim konstrukce, nekonečná přímka |
| [[M32-ciselny-vstup\|M32]] | Číselný vstup | `sketcher`, `interaction`, `render`, `ui` | délka, úhel a souřadnice z klávesnice při kreslení ([[Q090 Číselný vstup při kreslení\|Q090]]) |
| [[M33-trim-extend-split\|M33]] | Trim, extend, split | `kernel`, `kernel-occt`, `sketch`, `sketcher`, `render` | ořezání, prodloužení a dělení křivek |
| [[M34-zaobleni-a-srazeni-ve-skice\|M34]] | Zaoblení a sražení ve skice | `sketch`, `sketcher`, `kernel`, `kernel-occt` | fillet a chamfer mezi dvěma křivkami |
| [[M35-offset\|M35]] | Offset | `kernel`, `kernel-occt`, `sketch`, `sketcher` | ekvidistanta křivky a řetězce v OCCT |
| [[M36-zrcadleni-a-pole\|M36]] | Zrcadlení a pole | `sketch`, `solver-planegcs`, `sketcher`, `render`, `ui` | parametrické zrcadlení, lineární a kruhové pole s vynesenými kótami ([[Q089 Parametrické zrcadlení a pole ve skice\|Q089]]) |
| [[M37-text-ve-skice\|M37]] | Text ve skice | `sketch`, `features/*`, `sketcher`, `render`, `ui` | text jako obrysy písmen přes opentype.js ([[0029-text-ve-skice-pres-opentype\|ADR 0029]]) |
| [[M38-zmrazeni-domeny\|M38]] | Zmrazení domény | `document`, `ops`, `regen`, `kernel`, `sketch`, `features/*` | TS doména zmrazená, sdílené testovací případy (JSON) jako specifikace C++ jádra |
| [[M39-kostra-serveru\|M39]] | Kostra serveru a GeometryService | `server`, `app`, `sketcher` | `server/` (CMake, vcpkg, nejnovější OCCT z vcpkg), Docker Compose s Envoy, `.proto` → C++ a TS, 2D geometrie skicáře přes gRPC |
| [[M40-dokument-a-operace-v-cpp\|M40]] | Dokument a operace v C++ | `server` | model dokumentu, schémata, operace, log, transakce, undo |
| [[M41-persistence-sqlite\|M41]] | Persistence v SQLite | `server` | SQLite soubor na dokument, idempotence, `DocumentService` |
| [[M42-jadro-occt-nativne\|M42]] | Jádro OCCT nativně | `server` | port `GeometryKernel` nad OCCT 8, tessellace, STEP, paměťový test |
| [[M43-regenerace-v-cpp\|M43]] | Regenerace a featury v C++ | `server` | Regenerator, pojmenování, buildery, `content_version` |
| [[M44-skica-na-serveru\|M44]] | Model skici a řešič v C++ | `server` | model skici, odvozené entity, nativní planegcs (souběžně od M39) |
| [[M44.1-builder-skici-na-serveru\|M44.1]] | Builder skici na serveru | `server`, `sketcher` | builder skici v regeneraci, server jako autorita skici (`SKETCH_NOT_SOLVED`) |
| [[M45-sezeni-pres-grpc\|M45]] | Sezení přes gRPC | `server` | `SessionService`: sezení, zámek, transakce, read model, `WatchSession` |
| [[M46-klient-nad-read-modelem\|M46]] | Klient nad read modelem | `remote`, `app`, `interaction`, `render`, `ui`, `features/*` | prohlížeč proti serveru, e2e přes Docker Compose |
| [[M47-uklid-a-dokonceni\|M47]] | Úklid a dokončení | `app`, `ui` a odstraněné moduly | bez WASM a domény v klientovi, specifikace serverové verze |
| [[M48-hlaseni-v-ui\|M48]] | Hlášení v UI | `app`, `ui`, `sketcher` | `AppSession.notice` a toast (N134) |
| [[M49-pravidla-validace-v-popisu\|M49]] | Pravidla validace v popisu typů | `server`, `remote`, `ui` | vlastní pravidla featur ve `FeatureTypeDescriptor` (N67) |
| [[M50-occt2d-a-vrstva-rpc\|M50]] | Knihovna occt2d a vrstva rpc | `server` | jeden 2D základ OCCT (N77), doména bez protobufu (N53) |
| [[M51-inverze-a-mereni\|M51]] | Inverze a měření | `server` | inverze po chybě zápisu (N35), měření výkonu regenerace (N142) |
| [[M52-tenky-klient\|M52]] | Tenký klient | `app`, `interaction`, `sketcher`, `ops`, `document` | klient bez handlerů operací ([[0031-tenky-klient-bez-handleru\|ADR 0031]], N63) |

**Noční rychloakce 2026-10-14:** [[M11-dalsi-entity|M11]]–[[M15-export-a-dokonceni|M15]] implementovány bez průběžného schvalování, rozhodnutí v [[Rozhodnutí noční rychloakce]]. M16 se tehdy nedělal – předpřipravený build stačil na celou první verzi. Pavel 2026-10-14 ho vrátil do plánu za M21 kvůli zásobníku Emscriptenu (A7 z [[Revize kódu 2026-10-14|revize kódu]]).

Stav milníků (`todo` / `doing` / `done`) je **jen ve vlastnostech** souborů milníků – tabulka níže se z nich generuje sama:

![[milniky.base#Přehled]]

## Závislosti milníků

```
M0 → M1 → M2 → M3 ─┬─► M4 ────────────────────────┐
                   │                              │
          M1 → M5 ─┴─► M6 ─► M7 ─► M8 ─► M9 ─► M10 ─► M10.1 ─► M11 ─► M12 ─► M13 ─► M14 ─► M15 ─► M16
                                                                                             └─► M17 ─► M17.1 ─► M18 ─► M19 ─► M19.1 ─► M19.2 ─► M20 ─► M21 ─► M22 ─► M23 ─► M24 ─┬─► M25 ─► M26 ─► M27 ─┬─► M16
                                                                                                                                                                                  ├─► M28 ───────────────┤
                                                                                                                                                                                  └─► M29 (1–7) ─► M29 (8, po M26)

Rozšíření skicáře II (po M29):
  stopa A: M30 ─► M33 ─► M34 ─► M35
  stopa B: M31 ─► M32
  stopa C: M36 ─► M37 (po sloučení M30)

Nativní jádro (po M37), stopy po M39:
  M38 ─► M39 ─┬─► stopa A: M40 ─┬─► M41 ─────────────────┐
              │                 ▼                        │
              ├─► stopa B: M42 ─► M43 ─► M44.1 ──────────┴─► M45 ─► M46 ─► M47
              │                            ▲
              └─► stopa C: M44 ────────────┘

  M43 začne po sloučení M40 a M42, M44.1 po sloučení M44, M45 po M41 a M44.1.
```

M4 (persistence) a M5 (port jádra) na sobě nezávisí – pořadí lze prohodit. Persistence je dřív, protože ověří formát logu, dokud je čerstvý.

Milník `MNN.X` je neplánovaná úprava mezi dvěma milníky ([[Konvence vaultu#Principy|konvence]]); M10.1 nese opravy z revize architektury po M10.

M16 (vlastní OCCT build) je od 2026-10-17 v archivu, nahradila ho série nativního jádra ([[#Nativní jádro (M38–M47)]]). Technicky potřeboval jen M7. Dlouho byl na konci, protože předpřipravený build stačí; od 2026-10-14 je zařazený za M21 kvůli zásobníku Emscriptenu a od 2026-10-15 za režimy zobrazení M22–M24 (Pavel chce teď pracovat na zobrazování). Přesune se dřív, pokud mu bude chybět API ([[0013-replicad-opencascadejs|ADR 0013]]).

**Rozšíření skicáře (M25–M29)**, naplánované 2026-10-15 po M24: glyfy vazeb → snapper a auto-vazby → oblouky a kružnice → kóty → spliny. Glyfy jsou první, protože bez nich nejde vidět, co snapper a nové nástroje vytvořily; spliny poslední, protože jako jediné sahají až do jádra. Předpřipravený OCCT build má `Geom2d_BSplineCurve`, takže M29 na M16 nečeká. Přehled v [[12-skicar#Rozšíření skicáře (M25–M29)]].

### Souběžné stopy (pokus od M25)

Pavel 2026-10-15 chtěl zkusit, jestli milníky může dělat víc agentů souběžně. Obecný postup je v metodice [[Souběžné stopy agentů]]; níže jsou pravidla této série. Rozhoduje průnik dotčených souborů, ne pořadí milníků, proto tři stopy, každá ve vlastní session a vlastním git worktree:

| Stopa | Milníky | Poznámka |
|---|---|---|
| A – interakce | [[M25-glyfy-vazeb\|M25]] → [[M26-snapper-a-auto-vazby\|M26]] → [[M27-oblouky-a-kruznice\|M27]] | postupně, všechny žijí v `sketch-session.ts`; [[Q084 Inference automatických vazeb\|Q084]] rozhodne stopa s Pavlem při startu M26 |
| B – kóty | [[M28-koty\|M28]] | souběžně s A |
| C – spliny | [[M29-spliny\|M29]] úkoly 1–7 | souběžně; úkol 8 (nástroje) až po sloučení M26 |

Pravidla:
1. Kontrakty sdílených typů jsou zafixované předem ve spec 12; stopa přidává jen své členy unií a větve `switch`.
2. Ve vaultu stopa mění jen **svůj milník**, **svou sekci spec 12** a své odstavce ve spec 06, 09, 10, 11. Deník nepíše – průběh zapisuje do sekce *Průběh stopy* ve svém milníku; do deníku ho přenese hlavní sezení při sloučení. Nové otázky zakládá s dalším volným číslem po kontrole `ls docs/60-otazky` v `main` a hned je hlásí.
3. Stopa commituje na svou větev, do `main` neslučuje. Před sloučením si natáhne `main`, vyřeší konflikty a spustí `npm run check` a `npm run test:e2e:full`. Sloučení dělá hlavní sezení, po jednom.
4. Retrospektiva série zhodnotí, jestli se souběh vyplatil (čas, konflikty, kvalita).

**Zhodnocení (2026-10-16):** série M25–M29 je celá v `main`. Souběh zrychlil práci zhruba dvakrát (4½ milníku za ~2 h 10 min), bez regrese po sloučení; nejtěžší pro Pavla byla ztráta přehledu (vznikl panel `/stopy`). Pavel: pokračovat i v dalších sériích. Podrobnosti v [[Souběžné stopy agentů#Zhodnocení první série (M25–M29, 2026-10-15 a 16)]], postup je skill `/stopa`.

## Rozšíření skicáře II (M30–M37)

Naplánováno 2026-10-16 po sérii M25–M29. Pavel: „Chtěl bych ještě dodělat do Sketch následující feature: obdélník zadaný středem a jedním krajním bodem, obdélník zadaný třemi body, možnost zadat bod, zadávat text, Construction Line, fillet a chamfer mezi dvěma hranami, trim, extend, split, offset, slot, mirror, linear a circular pattern.“

Rozhodnutí v sezení 2026-10-16:
- **Celá geometrie skici do OCCT** ([[Q088 Geometrie skici v TypeScriptu nebo v OCCT#Znovuotevření 2026-10-16|Q088]], [[0028-geometrie-skici-v-jadre|ADR 0028]]) jako samostatný milník [[M30-geometrie-skici-v-occt|M30]] před operacemi, které geometrii mění.
- „Construction Line“ = režim konstrukce **i** nekonečná přímka; „zadat bod“ = nástroj Bod **i** číselný vstup.
- Text přes **opentype.js** ([[0029-text-ve-skice-pres-opentype|ADR 0029]]).
- Zrcadlení a pole jako **parametrická entita** s vynesenými kótami ([[Q089 Parametrické zrcadlení a pole ve skice|Q089]]).
- Drážky: přímá střed–střed, přímá celkovou délkou, oblouková.

Souběžné stopy podle metodiky [[Souběžné stopy agentů]] (pravidla 1–4 jako u první série):

| Stopa | Milníky | Poznámka |
|---|---|---|
| A – geometrie | [[M30-geometrie-skici-v-occt\|M30]] → [[M33-trim-extend-split\|M33]] → [[M34-zaobleni-a-srazeni-ve-skice\|M34]] → [[M35-offset\|M35]] | jádro a OCCT; [[Q092 Hranice geometrie skici v TS a v OCCT\|Q092]] při startu M30 |
| B – kreslení | [[M31-nove-kreslici-nastroje\|M31]] → [[M32-ciselny-vstup\|M32]] | jen nové entity a vazby; [[Q090 Číselný vstup při kreslení\|Q090]] při startu M32 |
| C – odvozené entity | [[M36-zrcadleni-a-pole\|M36]] → [[M37-text-ve-skice\|M37]] | úkol 5 M36 (kopie v oblastech) a M37 až po sloučení M30; [[Q089 Parametrické zrcadlení a pole ve skice\|Q089]] rozhodnutá, [[Q091 Fonty pro text ve skice\|Q091]] při startu M37 |

Sdílené kontrakty jsou zafixované (2026-10-16) v [[12-skicar#Sdílené kontrakty série II]]: kdo přidává které členy unií, nekonečná přímka, vazba symetrie, `regionCurves` a odvozená id, id nástrojů a akcí. Port jádra M30 je v [[12-skicar#Geometrie skici v jádře (M30)]] a [[06-geometricke-jadro#Stav po M30]], implementační plán v [[M30-geometrie-skici-v-occt#Implementační plán]]. Stopa A smí jako jediná měnit `kernel`, `kernel-occt` a builder skici.

**Zhodnocení série II (2026-10-17):** M30–M37 celé v `main` – 8 milníků za ~6½ h práce, bez regrese, e2e 136 → 186. Pavel: „v pohodě“, pokračovat; nejtěžší přehled o stavu a zkoušení výsledku. Nová pravidla v metodice: stopa si před sloučením natáhne `main`; hlavní checkout jen dispečer (drobná vylepšení souběžně se stopami ve vlastní session a worktree); hlášení po sloučení s „co zkusit“. Podrobnosti v [[Souběžné stopy agentů#Zhodnocení druhé série (M30–M37, 2026-10-16 a 17)]].

## Nativní jádro (M38–M47)

Naplánováno 2026-10-17 po sérii M30–M37 podle [[Q094 Nativní jádro na serveru přes gRPC|Q094]] a navazujících otázek [[Q096 Geometrie skici přes síť|Q096]]–[[Q106 Moduly klienta pro gRPC|Q106]]. Rozhodnutí shrnuje [[0030-nativni-jadro-pres-grpc|ADR 0030]] (přijaté 2026-10-17), kontrakt je [[14-protokol|spec 14]] a soubory `server/proto/tinycad/v1/*.proto`. Dokument, operace, regenerace a OCCT se přepíšou **naráz** do C++ jádra `tinycad-core`; prohlížeč s ním mluví přes gRPC-Web a Envoy v Docker Compose. [[M16-vlastni-occt-build|M16]] je archivovaný.

Proč toto pořadí:
- **M38 první:** přepis naráz potřebuje pevný cíl. Zmrazená TS doména a sdílené testovací případy (JSON) jsou specifikace, proti které se C++ ověřuje od prvního dne.
- **M39 jako svislý řez:** bezstavová `GeometryService` projde celým stackem (vcpkg, `.proto`, Envoy, gRPC-Web, adaptér za portem) bez doménového stavu. Hned je co spustit a riziko „dlouho nic nefunguje“ se zmenší.
- **Odspodu nahoru jako v M0–M10:** dokument a operace (M40) → persistence (M41) a jádro (M42) → regenerace (M43) → skica (M44, M44.1) → služba sezení (M45) → klient (M46). Každá vrstva je hotová a otestovaná v C++, než na ní stojí další.
- **Souběžně od M39** (Pavel 2026-10-17): M42 potřebuje jen kostru z M39, ne model dokumentu, proto běží vedle M40. Model skici a řešič (M44) na regeneraci nezávisí, proto se oddělily od builderu skici (M44.1) a běží jako třetí stopa. Kritická cesta je M39 → M40 ∥ M42 → M43 → M44.1 → M45 → M46 → M47; M41 a M44 jsou mimo ni.
- **M47 až na konec:** WASM a TS doména zůstávají v klientovi, dokud M46 nepřepne aplikaci na server. Až do té doby aplikace běží.

**Souběžné stopy** (metodika [[Souběžné stopy agentů]]) po sloučení M39, průnik souborů je malý:

| Stopa | Milníky | Soubory | Čeká na |
|---|---|---|---|
| A – dokument a úložiště | [[M40-dokument-a-operace-v-cpp\|M40]] → [[M41-persistence-sqlite\|M41]] | `server/src/document/`, `ops/`, `storage/`, schémata `features/*/schema.*` | – |
| B – geometrie | [[M42-jadro-occt-nativne\|M42]] → [[M43-regenerace-v-cpp\|M43]] → [[M44.1-builder-skici-na-serveru\|M44.1]] | `server/src/kernel/`, `regen/`, buildery `features/` (od M43) | M43 natáhne `main` se sloučeným M40, M44.1 se sloučeným M44 |
| C – skica | [[M44-skica-na-serveru\|M44]] | `server/src/sketch/`, `solver-planegcs/`, `server/third_party/planegcs/` | – |

Pravidla série:
- **Úkol 0 hlavního sezení** po sloučení M39 a před startem stop ([[Rozhodnutí nativního jádra|N11]]): dokončit společnou oblast `server/src/core` (`tinycad_core`: matematika, `Curve2`, `StrongId`, `Result`, JSON), převést `tinycad_geometry` z M39 na `core::Curve2` a vytáhnout podporu sdílených případů (načtení obálky, porovnání s tolerancemi) do `tinycad_test_support`. Oblast `core` pak mění jen hlavní sezení.
- **Sdílené kontrakty** jsou zafixované jako hlavičky (2026-10-17, [[Rozhodnutí nativního jádra|N13–N24]]): `server/src/{core,document,kernel,sketch,solver-planegcs}/include/tinycad/**/*.hpp`. Používají je: model dokumentu a registr schémat (M40 → M41, M43), port jádra `GeometryKernel` (M42 → M43), model skici a řešič (M44 → M44.1). Změna zafixované hlavičky jde přes hlavní sezení.
- **Build:** každá oblast má vlastní knihovnu v `server/src/<oblast>/CMakeLists.txt`, kořenový `CMakeLists.txt` stopy jen doplňují o `add_subdirectory` (sčítací konflikty). `vcpkg.json` a baseline mění jen hlavní sezení; závislosti planegcs (Eigen, případně Boost) přidá už [[M39-kostra-serveru|M39]], aby stopy baseline neměnily souběžně. Binární cache vcpkg je sdílená mezi worktree, adresáře buildu jsou vlastní.
- Každá stopa ověřuje svou část proti sdíleným případům z [[M38-zmrazeni-domeny|M38]]: A `ops.*`, `document.load`, `schema.*`; B `geometry.*` (už M39), `regen`; C `sketch.solve`, `sketch.derived`.
- M45 začne po sloučení všech tří stop. [[M46-klient-nad-read-modelem|M46]] se nedělí (Pavel 2026-10-17), jde po M45.

**Pravidlo zmrazení (od startu M38) skončilo s M47** (2026-10-17): doména je v C++ (`server/src/`), z `src/` zmizely `kernel-occt`, `regen`, `persistence` a buildery featur; v klientovi zůstává zrcadlo (`document`, handlery `ops`) a model skici. Série běžela jako samostatný běh bez průběžného schvalování, rozhodnutí v [[Rozhodnutí nativního jádra]].

**Otázky série:** všechny rozhodnuté (2026-10-17), naposledy [[Q103 Skica, kterou server nevyřeší|Q103]] a [[Q106 Moduly klienta pro gRPC|Q106]].

## Po nativním jádře (M48–M52)

Naplánováno 2026-10-17 z Pavlových rozhodnutí sporných míst samostatného běhu ([[Rozhodnutí nativního jádra#Pavlova rozhodnutí sporných míst (2026-10-17)]]). Hrubý plán, každý milník se před startem upřesní.

**Souběžné stopy** (malý průnik souborů):

| Stopa | Milníky | Soubory |
|---|---|---|
| A – server | [[M50-occt2d-a-vrstva-rpc\|M50]] → [[M51-inverze-a-mereni\|M51]] | `server/src/` |
| B – klient | [[M48-hlaseni-v-ui\|M48]] → [[M52-tenky-klient\|M52]] | `src/app`, `src/ui`, `src/interaction`, `src/sketcher` |
| C – kontrakt | [[M49-pravidla-validace-v-popisu\|M49]] | `server/proto`, `server/src/features`, `src/remote` |

M52 začne po sloučení M48 a M49 (dialog featur potřebuje kanál hlášení i pravidla z popisu). Průnik A × C: `server/src/session` (popisy typů vs. vrstva rpc) – sdílené rozhraní popisů typů zafixovat při startu stop.

## Jak pracovat s milníkem

1. Při zahájení nastav ve vlastnostech milníku `status: doing` a `started`. Přečti si soubor milníku a odkazované specifikace. U milníků označených „hrubý plán“ nejdřív upřesni úkoly a akceptační kritéria (a případně specifikaci).
2. Úkoly plň v uvedeném pořadí, po každém spusť `npm run check`.
3. Po dokončení zaškrtni úkol. Odchylky od specifikace propiš do specifikace.
4. Milník je hotový, když platí všechna akceptační kritéria. Pak nastav ve vlastnostech milníku `status: done` a `finished`.
5. Na konci milníku krátká retrospektiva v souboru milníku: co bylo jinak, než se čekalo. Co stojí za zapamatování obecně, zapiš jako [[Konvence vaultu#Poznatky|poznatek]].
