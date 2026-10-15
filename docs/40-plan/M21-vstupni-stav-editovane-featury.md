---
type: milestone
status: done
order: 21
aliases:
  - M21
  - M21 Vstupní stav editované featury
modules:
  - ops
  - regen
  - interaction
  - sketcher
  - render
  - app
  - ui
specs:
  - "[[04-operace-a-historie]]"
  - "[[07-regenerace]]"
  - "[[09-vykreslovani]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
  - "[[12-skicar]]"
depends_on:
  - "[[M20-zpevneni-struktury]]"
started: 2026-10-15
finished: 2026-10-15
tags:
  - milnik
created: 2026-10-14
updated: 2026-10-15
---
# M21 – Vstupní stav editované featury

**Cíl:** dialog featury a skicář vybírají, zvýrazňují a počítají roviny nad stejným stavem, ve kterém [[Builder featury|builder]] vyhodnocuje reference (A1 z [[Revize kódu 2026-10-14|revize kódu]]).

**Specifikace:** [[0025-vstupni-stav-editovane-featury|ADR 0025]], [[04-operace-a-historie]], [[07-regenerace]], [[09-vykreslovani]], [[10-interakce]], [[11-ui]], [[12-skicar]]

**Navazuje na:** [[M20-zpevneni-struktury|M20]]. Pavel 2026-10-14: A1 až po zpevnění struktury, protože bude stavět na tabulce druhů referencí (A2).

## Rozhodnutí (Pavel 2026-10-15)

- **D1 – Varianta A z [[Q075 Vstupní stav editované featury|Q075]]** ([[0025-vstupni-stav-editovane-featury|ADR 0025]]): při otevřené session dialogu je pickovatelný model vstup editované featury, výsledek je náhled.
- **D2 – Vzhled:** vstup pevně (picking, zvýraznění), výsledek přes něj jako průhledný náhled v barvě náhledu palety.
- **D3 – Výběr:** i běžný výběr během dialogu jde nad vstupem. Jeden invariant pro všechno, co převádí index na jméno.
- **D4 – Rovina skici** ([[Q076 Rovina a hrany z Prohlížeče do referenčního parametru|Q076]]): `planes` hned není `focusable` (hotovo 2026-10-15). Změna roviny existující skici přes pole „Rovina“ v panelu skicáře, které přepne skicář do výběru roviny (roviny počátku, rovinné plochy vstupu, řádky rovin v Prohlížeči). Esc výběr ukončí.

## Úkoly

- [x] Q076 hned: `planes` není `focusable` (hlavní sezení, 2026-10-15)
- [x] Ú1 Slučování kroků transakce v `applyStep` (`ops`)
- [x] Ú2 Vstup editované featury v `RegenResult` (`regen`)
- [x] Ú3 Náhledová vrstva těles (`render`)
- [x] Ú4 `RegenSnapshot.pick` a čtenáři v `interaction`
- [x] Ú5 Regenerace při otevřené session: dvě vrstvy a `pick` (`app`)
- [x] Ú6 Rovina skici: z artefaktu a pole „Rovina“ v panelu skicáře (`sketcher`, `interaction`, `ui`, `app`)
- [x] Ú7 E2E scénáře a ověření
- [x] Opravy z architektonické revize (skrytí spotřebovaného tělesa, pořadí `clear`/`sync`, atomická výměna vrstev, `SketchPanel` bez logiky, výběr stejné roviny, sdílené čtení reference roviny)
- [x] Ú8 Skica bez roviny ([[Q079 Skica se zaniklou rovinou|Q079]]) a jantarová barva náhledu
- [x] Revize (`architecture-reviewer`), uzavření

## Implementační plán

### Společná pravidla

- Kód, komentáře a commity anglicky. TypeScript `strict`, žádné `any`, neměnná data, TDD, `npm run check` zelený. Testy v `test/unit/<modul>/` (zrcadlově), importy přes `@/` ([[0023-testy-mimo-zdrojaky|ADR 0023]]).
- Úkoly jdou postupně v pořadí Ú1 → Ú7, každý zkontroluje hlavní sezení a propíše spec.

### Ú1 Slučování kroků transakce v `applyStep`

- **Soubory:** `src/ops/transaction.ts`, testy `test/unit/ops/transaction*.test.ts`.
- **Kontrakt:** po `apply(op)` se nový krok sloučí s bezprostředně předchozím, když oba nejsou transientní, mají stejný typ a `handler.merge(last.op, op)` vrátí operaci. Sloučený krok má `op: merged` a **inverzi prvního** kroku. Jinak se krok přidá. Mezi dvěma kroky s transientním krokem uprostřed se neslučuje. `emitApplied` se volá pro každou operaci jako dosud. `compress()` při `commit` zůstává jako pojistka (je idempotentní nad už sloučenými kroky).
- **Testy:** 1000 `feature.setParams` téže featury → v transakci jeden krok; `abort` zavolá jednu inverzi a dokument je jako před transakcí; kroky různých featur nebo typů se neslučují; transientní krok mezi nimi slučování přeruší; `commit` zapíše do logu totéž co dřív (stávající testy).
- **Hotovo když:** testy projdou, `npm run check` zelený.
- **Spec:** [[04-operace-a-historie]] (transakce).

### Ú2 Vstup editované featury v `RegenResult`

- **Soubory:** `src/regen/regenerator.ts`, `src/regen/index.ts`, testy `test/unit/regen/regenerator*.test.ts`.
- **Kontrakt:**
  - `run(studio, opts?: { readonly inputOf?: FeatureId })`.
  - `RegenResult.input: { readonly feature: FeatureId; readonly state: RegenState } | null`. `state` je `entries[i-1]?.state ?? EMPTY_STATE` featury `inputOf`, když je před lištou (i potlačená nebo chybná). Jinak a bez `inputOf` `null`.
  - Handle vstupu jsou živé, dokud je stav v cache (mark & sweep drží všechny stavy cache, beze změny).
  - Plánovač (`RegenScheduler`) a stávající volající bez `opts` se nemění.
- **Testy:** vstup featury uprostřed historie je stav po předchozí featuře (identita objektu); první featura → `EMPTY_STATE`; featura za lištou nebo neexistující → `null`; featura z cache (bez přepočtu) má vstup také; handle vstupu po sweepu žijí (`liveHandleCount`).
- **Hotovo když:** testy projdou, `npm run check` zelený.
- **Spec:** [[07-regenerace]] (`Regenerator`, `RegenResult`).

### Ú3 Náhledová vrstva těles

- **Soubory:** `src/render/` (nová vrstva vedle `BodyLayer`, `viewport.ts`, `palette.ts` pokud je potřeba, `index.ts`), testy v `test/unit/render/`.
- **Kontrakt:**
  - `Viewport.preview: { sync(bodies: readonly { id: BodyId; shape: ShapeHandle }[]): Promise<void>; clear(): void }` – druhá instance synchronizace těles (`SceneSync`) s vlastní mapou podle `BodyId` a sdílenou cache sítí podle handle.
  - Materiály: plochy průhledné (`transparent`, `opacity` 0,35, `depthWrite: false`) a hrany v barvě `palette.preview`, `renderOrder` nad tělesy a pod zvýrazněním. `setPalette` přebarví.
  - Náhled se **nepickuje** a **nezvýrazňuje** (picker i `HighlightLayer` čtou jen hlavní vrstvu). Skrytí a barvy podle `BodyId` (`setBodyVisible`, `setBodyColor`) platí pro obě vrstvy.
  - Obálka pro near/far a `fitAll` zahrnuje i náhled.
  - `clear()` náhled odebere a uvolní, `dispose` viewportu ho uvolní.
- **Testy:** čisté části bez `three` (obálka; výběr těles náhledu patří do `app`, Ú5) v Node; vrstva: `sync` přidá a odebere tělesa, stejný handle se netesseluje znovu (sdílená cache), picker náhled nevidí (fake/čistá funkce podle toho, co jde testovat v Node).
- **Hotovo když:** testy projdou, `npm run check` zelený.
- **Spec:** [[09-vykreslovani]] (nová sekce Náhled).

### Ú4 `RegenSnapshot.pick` a čtenáři v `interaction`

- **Soubory:** `src/interaction/regen-status-port.ts`, `feature-dialog/ref-kinds.ts`, `feature-dialog/ref-pick-tool.ts`, `selection.ts`, `topo-inspector.ts`, `testing.ts` (`FakeRegenStatus`), testy.
- **Kontrakt:**
  - `RegenSnapshot.pick: { readonly feature: FeatureId | null; readonly bodies: readonly RegenBody[] }`. `feature` je featura, jejíž vstup `bodies` jsou, `null` = koncový stav. Výchozí (bez session) `pick.bodies === bodies`.
  - `nameOfHit` a všechny převody index → jméno a jméno → indexy (`refPick`, `highlightTargets` u `topo` a `bodies`, `SelectionModel.set`/`toggle` a přemapování, `TopoInspector`) čtou `snapshot.pick.bodies`, ne `snapshot.bodies`.
  - **Mezistav:** `refPick` při otevřené session ignoruje zásahy (hover i klik), dokud `snapshot.pick.feature !== session.featureId`.
  - `snapshot.bodies` čtou dál jen Prohlížeč a export.
- **Testy:** zásah do hrany se jménem jen ve vstupu se převede na jméno vstupu; jméno, které je jen ve výsledku, `refPick` nevezme; zvýraznění vybrané hrany se počítá z `pick` (hrana, kterou výsledek nemá, je zvýrazněná); mezistav ignoruje zásahy; bez session se chování nemění.
- **Hotovo když:** testy projdou, `npm run check` zelený.
- **Spec:** [[10-interakce]] (port stavu regenerace, referenční parametr, výběr).

### Ú5 Regenerace při otevřené session (`app`)

- **Soubory:** `src/app/regen-pipeline.ts`, `regen-status-adapter.ts`, `viewport-mirror.ts`, `session.ts` (předání `features`), testy v `test/unit/app/`.
- **Kontrakt:**
  - Pipeline zná `features.current` a při otevřené session volá `run(studio, { inputOf: session.featureId })`.
  - S `result.input`: hlavní vrstva `viewport.bodies.sync(tělesa vstupu)`, náhled `viewport.preview.sync(tělesa výsledku, která ve vstupu nejsou se stejným handle)`. Bez session nebo bez vstupu: hlavní vrstva koncový stav a `preview.clear()`.
  - Obě synchronizace proběhnou před `publish` (D3 z M19.1). Snapshot: `bodies` z koncového stavu, `pick` z vstupu (`feature = session.featureId`) nebo z koncového stavu (`feature = null`).
  - `refPick` (`inputPending()` v `ref-pick-tool.ts`) zpřísnit na `snapshot.pick.feature !== session.featureId` a otočit test „pick.feature null“ z Ú4 (dočasné pravidlo pouštělo zásahy při `null`).
  - Otevření a zavření session vyžádá regeneraci (`regenScheduler.request()`), aby se vrstvy přepnuly i bez změny dokumentu.
  - `ViewportMirror.reapply()` použije skrytí a barvy i na náhled. `lastState()` zůstává koncový stav.
- **Testy (s fakes):** otevřená edit session → hlavní vrstva dostane tělesa vstupu, náhled změněná tělesa, snapshot `pick.feature` = featura; zavření → náhled prázdný, hlavní vrstva koncový stav; pořadí: obě `sync` před `publish`; zastaralá regenerace nic nezveřejní (stávající testy).
- **Hotovo když:** testy projdou, `npm run check` a e2e zelené.
- **Spec:** [[11-ui]] (Kompoziční kořen, krok regenerace).

### Ú6 Rovina skici

- **Soubory:** `src/sketcher/sketch-editor.ts`, `sketch-session.ts`, `src/interaction/feature-dialog/ref-kinds.ts` (`planes`), `src/app/session.ts` (`resolvePlane`, `planeOfSketch`), `src/ui` (panel skicáře, pole Rovina), testy.
- **Kontrakt:**
  - **Rovina editované skici:** `SketchEditorDeps.planeOfSketch(featureId): Plane | undefined` = `SketchArtifact.plane` skici z posledního stavu. `edit` ji použije; když chybí, `resolvePlane(ref)` jako dosud. Skica po pozdější Transformaci a Booleanu, který těleso spotřebuje, se otevře na své původní rovině (R108).
  - **`planes` v tabulce druhů:** `focusable: true`, `autoFocus: false`; `pickFilter` = plochy a entity kreseb rovin; `fromHit`: zásah kresby roviny počátku (`parsePlaneId` id kresby) → `PlaneRef`, zásah plochy → `TopoRef` přes `pick` (rovinnost ověří regenerace); `browserAccepts('plane')`; nahrazuje jedinou položku (`max: 1`). Hover jen převoditelné zásahy.
  - **Pole „Rovina“ v panelu skicáře:** ukazuje čip roviny (`refText`/`chips` z tabulky). Klik → `focusRefParam('plane')` edit session skici; `refPick` vrstva je nad nástroji skicáře, takže kreslení se tím pozastaví. Esc nebo vybraná rovina → fokus pryč a zpět ke kreslení.
  - **Změna roviny za běhu:** `SketchSession.plane` je `Observable<Plane>`. Po změně parametru `plane` se rovina přepočítá (`resolvePlane`), skicář překreslí kresbu a nastaví pohled kolmo na novou rovinu. Entity zůstávají ve 2D souřadnicích nové roviny.
- **Testy:** `edit` bere rovinu z artefaktu i když `planeOfRef` nad koncovým stavem selže; tabulka `planes` (zásah roviny počátku, plochy, Prohlížeč, nahrazení); pole v panelu (model/čistá funkce v `ui`); změna roviny přepočte `plane` a zavolá pohled.
- **Hotovo když:** testy projdou, `npm run check` a e2e zelené.
- **Spec:** [[12-skicar]], [[10-interakce]] (tabulka druhů), [[11-ui]] (panel skicáře).

### Ú7 E2E scénáře a ověření

- **Soubory:** `test/e2e/m21.spec.ts`.
- **Scénáře:** (1) kvádr, zaoblení hrany, edit zaoblení: vybraná hrana je zvýrazněná, klik na další hranu přidá referenci a featura nespadne; (2) skica na horní ploše kvádru, pak Transformace a Boolean, který kvádr spotřebuje: skica se otevře; (3) změna roviny skici polem „Rovina“ na jinou rovinu počátku.
- **Hotovo když:** `npm run test:e2e` celé zelené.

### Ú8 Skica bez roviny a barva náhledu

- **Soubory:** `src/sketcher/sketch-editor.ts`, `sketch-session.ts`, `src/ui` (panel skicáře, i18n), `src/render/palette.ts`, testy.
- **Kontrakt:**
  - [[Q079 Skica se zaniklou rovinou|Q079]], varianta A: když `edit` rovinu nespočítá ani z artefaktu, ani z reference, skicář se otevře na rovině počátku XY (`ORIGIN_PLANES`), `SketchState` nese příznak `planeMissing: true` a výběr roviny je hned aktivní (`pickPlane()`). Panel ukáže hlášku „Rovina skici chybí, vyberte novou“ (cs i en). Po výběru roviny příznak zmizí. Zrušení výběru bez nové roviny nechá skicu otevřenou na XY s hláškou; „Hotovo“ uloží jen entity a vazby, rovinu nezmění (skica dál v chybě, dokud se rovina nevybere).
  - **Barva náhledu** (`palette.preview`): jantarová, odlišná od modrých těles i od oranžové výběru, v obou paletách s dostatečným kontrastem vůči pozadí. Barvy čar nástrojů (overlay `preview`) sdílejí tutéž položku palety – zkontrolovat, že jim jantarová nevadí, jinak zavést samostatnou položku pro náhled těles.
- **Testy:** `edit` skici bez roviny neselže, otevře se na XY s `planeMissing` a aktivním výběrem; výběr roviny příznak zruší; hodnoty palety (kontrast vůči pozadí, odlišnost od `face`, `selection`, `hover`).
- **Hotovo když:** testy projdou, `npm run check` a e2e zelené, snímek náhledu v prohlížeči.
- **Spec:** [[12-skicar]] (rovina), [[11-ui]] (panel), [[09-vykreslovani]] (palety).

## Akceptační kritéria

Splnění (kontrola 2026-10-15):

- Klik na hranu u plochy zaoblení při editaci zaoblení neuloží jméno z výstupu téže featury. → e2e `m21` scénář 1 (klik na tečnou hranu nic nepřidá); před M21 týž test padá na „Vybráno: 3“.
- Vybrané hrany v dialogu zaoblení jsou zvýrazněné. → unit testy `highlightTargets` nad `pick` (Ú4); ručně ověřeno v prohlížeči (zkosení, snímek).
- Skica na ploše se otevře i po pozdější Transformaci a Booleanu, který těleso spotřebuje. → e2e scénář 2; před M21 padá na `the plane of sketch … cannot be resolved`.
- Během editace je výsledek featury vidět jako průhledný náhled, který se nepickuje. → testy `body-layers` (picker a zvýraznění jen hlavní vrstva), ručně ověřeno; z-fighting nalezený ručně opraven offsetem ke kameře.
- Rovinu existující skici jde změnit v panelu skicáře. → e2e scénář 3; skica bez roviny scénář 4 (Q079).
- „Zrušit“ po tažení se tisíci kroky přehraje jednu inverzi. → `transaction.test.ts` (1000× `setParams`, jedna inverze).
- `npm run check` a e2e zelené. → 5358 unit + 35 integračních testů, e2e 78/78.

## Co se naučíš

- Proč CAD při editaci featury ukazuje model před ní (vstupní stav) a jak to souvisí s topologickým pojmenováním.
- Jak udržet index z pickingu a jméno ve stejné generaci i se dvěma vrstvami.
- Slučování operací v transakci a proč inverze zůstává z prvního kroku.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(Návrh Clauda, Pavel schválil 2026-10-15.)_

- **Co bylo jinak, než se čekalo:**
  - Testy prošly a přesto bylo potřeba dvakrát zasáhnout „zvenku“. E2E scénář 1 na kódu před M21 **prošel**: klikal na hranu, jejíž jméno platilo i dřív. Teprve spuštění proti starému commitu to odhalilo. Druhý případ: z-fighting náhledu viditelný jen v prohlížeči, 5300 testů v Node ho nemohlo chytit.
  - Architektonická revize našla jemnou mezeru v invariantu D3: „obě vrstvy před `publish`“ nestačí, výměna musí být atomická. Řešení `syncLayers` (prepare/commit) zároveň odstranilo zbytečnou tessellaci i problikávání při zavření dialogu.
  - Slučování kroků v `applyStep` bylo podle plánu nejmenší úkol a opravdu jím bylo.
- **Co se osvědčilo:**
  - Pole `snapshot.pick` vybírané v `app`: `interaction` se nemusí ptát, jestli je otevřený dialog, a invariant „index a jméno ze stejného stavu“ drží na jednom místě.
  - Rozhodnutí s Pavlem před plánem (vzhled náhledu, výběr nad vstupem, kde měnit rovinu). Implementátoři se pak zastavovali jen na skutečných mezerách (mezistav v Ú4, výběr těles náhledu v Ú3).
  - Ověření testů proti kódu před změnou ([[Měření, které nemůže selhat]]).
- **Co zůstává:**
  - Esc ukončí výběr reference jen při fokusu ve viewportu nebo na tlačítku pole, globální akce chybí.
  - Při otevření editace proběhne jedna regenerace navíc (první bez vstupu); výsledek je správný, stojí jednu tessellaci.
  - Po Ú8 už neproběhla druhá architektonická revize (Ú8 byl malý, zkontroloval ho hlavní sezení).


