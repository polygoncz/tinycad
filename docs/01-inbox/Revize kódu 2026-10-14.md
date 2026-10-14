---
type: note
tags:
  - inbox
created: 2026-10-14
updated: 2026-10-14
---
# Revize kódu 2026-10-14

Důkladná revize celého kódu po [[M19-manipulator-fusion|M19]] na Pavlovu žádost (Claude). Navazuje na [[Revize architektury 2026-10-13]], ale nezůstává u architektury: prochází i kvalitu a členění kódu, testy, UI a UX. **Nic se tu nerozhoduje.** Nálezy jsou kandidáti na milník oprav, otázky v `60-otazky/` nebo ADR (viz [[#Doporučené pořadí]]).

## Jak revize proběhla

1. **Devět recenzentů paralelně**, každý na svou oblast:
   - formální kontrola proti ADR 0008–0011 (`architecture-reviewer`),
   - celková architektura,
   - doména (`core`, `document`, `ops`, `persistence`, `regen`),
   - geometrie (`kernel`, `kernel-occt`, `sketch`, `solver-planegcs`),
   - `interaction`,
   - `render`,
   - `app` a `features/*`,
   - `ui`,
   - testy.
2. **Ruční průchod aplikací** v prohlížeči. Seznam dokumentů → nový dokument → skica s kótou → vysunutí tažením šipky → zaoblení → úprava vysunutí → undo → tmavý režim → angličtina → panel historie → úzké okno.
3. **Ověření.** Nejzávažnější tvrzení recenzentů jsem zkontroloval v kódu nebo v prohlížeči. Recenzenti se mýlí systematicky a jeden nález se ukázal jako mylný ([[#Vyvrácené a nejisté nálezy]]).

**Výchozí stav:** `npm run check` zelený (4582 testů ve 186 souborech), `npm run test:integration` zelený (33 testů). Unit testy prošly i dvakrát v náhodném pořadí.

## Shrnutí

**Kostra drží.** Featura je opravdu plugin: Fillet tvoří 5 souborů pluginu a 1 řádek v `app/plugins.ts`. Mimo `features/` není `switch` podle typu featury, s jedinou vědomou výjimkou skici ([[0017-modul-sketch-a-skicar|ADR 0017]]). Prstence 1 a 2 jsou čisté. Porty definuje spotřebitel. Správa paměti OCCT je disciplinovaná (`using` a `delete` všude) a doménová data jsou opravdu neměnná. Revize 2026-10-13 je z velké části vyřešená.

Problémy se soustředí na **tři místa**:

1. **Švy mezi dvěma okamžiky stavu.** Port stavu regenerace a sítě ve viewportu jsou dvě různé generace. Dialog featury pracuje nad koncovým stavem, ale reference se vyhodnocují ve vstupu editované featury. Transakce roste s každým snímkem tažení. Z toho plynou tiché záměny referencí a samoreference ve Fillet dialogu, kterou jsem v prohlížeči zopakoval.
2. **Chybové cesty.**
   - Zápis neprochází validací, kterou má čtení.
   - Pád jádra mimo regeneraci nikdo nezjistí.
   - Výjimky OCCT se neuvolňují.
   - Trvalé chyby úložiště se opakují donekonečna.
   - Chyby regenerace a ukládání jsou v UI skoro neviditelné.
3. **Vrstva UI.**
   - Tři skutečné chyby: kontextové menu mimo obrazovku, zaseknuté tažení rollback baru, „Upravit featuru“ u skici.
   - Ovládání klávesnicí skoro chybí.
   - Dialog featury neukáže, proč featura selhala.

**Testy jsou nadprůměrné:** kontraktové sady s chybovými cestami, determinismus, property testy. Mají ale díru: integrační testy neběží v `npm run check`, vrstva `render` a práce s plátnem testy nemají a několik testů projde i s rozbitým kódem.

## Ověřené chyby

Tyhle nálezy jsou potvrzené v prohlížeči nebo přímo v kódu. Patří mezi první opravy.

| # | Chyba | Kde | Ověřeno | Oprava |
|---|---|---|---|---|
| C1 | Kontextové menu [[Timeline\|timeline]] se vykreslí mimo obrazovku (`top` 1458 px při výšce okna 768). Dropdown „Zobrazit“ v liště se otevírá **pod** dialogem featury. | `Timeline.vue:159-166, 194`, `Toolbar.vue:103-110, 125`, `ContextMenu.vue:54, 76` | prohlížeč | `<Teleport to="body">` a ořez polohy do okna |
| C2 | Tažení [[Rollback bar\|rollback baru]] se zasekne: bar se posune o krok a zůstane viset, model zůstane na konci (UI a model se rozejdou do reloadu) | `Timeline.vue:88-97, 126-157` | prohlížeč | jeden trvalý prvek baru mimo `v-for`, nebo posluchače na `window` |
| C3 | „Upravit featuru“ z kontextového menu na skice otevře obecný dialog (jen pole „Rovina“) místo skicáře | `builtin-actions.ts:172-175` proti `feature-tree.ts:161-170` | prohlížeč | `run: () => featureTree.edit(id)` |
| C4 | Fillet a Chamfer. Klik na hranu u vlastní plochy zaoblení uloží samoreferenci (`edge:…/face:fillet:…`) a featura spadne. Vybraná hrana není zvýrazněná, hranu nejde odebrat jinak než zrušením dialogu a dialog o chybě mlčí. Tooltip ukazuje syrové interní jméno a anglickou hlášku. | `feature-editor.ts:189, 201-211`, `ref-pick-tool.ts:119-125` | prohlížeč | viz [[#A1. Dva okamžiky stavu\|A1]] |
| C5 | Zápis nevaliduje, co čtení odmítne. `NaN`/`Infinity` v parametrech, barva `#FF0000` nebo id featury s `/` se zapíše do logu a dokument **už nepůjde otevřít**. `MemoryDocumentStore` to v testech maskuje (JSON kopie převede `NaN` na `null`). | `ops/apply.ts:27-45`, `document/serialize.ts:288-298`, `persistence/memory-store.ts:22-29` | kód | `handler.validate` a kontrola čistého JSONu v `applyOperation`; paměťový store ať porovná kopii s originálem |
| C6 | Index z pickingu se převádí na topologické jméno tabulkou **jiné generace**. `regenStatus.publish` je hned, `viewport.bodies.sync` až po tessellaci. V tom okně se uloží `TopoRef` jiné hrany a zvýraznění s indexem mimo starou síť zhasne natrvalo. | `app/session.ts:447-460`, `selection.ts:80-89, 335, 344`, `highlight-layer.ts:145, 158-164` | kód (2 recenzenti nezávisle) | zveřejnit tělesa a jména až po `sync` téže generace, nebo generace v `PickResult` |
| C7 | Pád jádra mimo regeneraci (tessellace, export STEP) nikdo nezjistí. Stav zůstane `ready`, těleso zmizí a restart přijde až při další úpravě. | `kernel-supervisor.ts:94-106`, `app/browser.ts:59-64` (viewport bez `reportError`) | kód (2 recenzenti) | klient jádra vystaví `onDisconnected`, supervisor se přihlásí |
| C8 | Výjimky OCCT se nikdy neuvolní. `decrementExceptionRefcount` se nevolá, takže každé selhání operace nechá v haldě WASM objekt `Standard_Failure`. Pravděpodobná příčina pádu po ~524 000 výjimkách z [[Q055 Pád WASM jádra\|Q055]]. | `kernel-occt/occt.ts:102-106` | kód | zavolat v `occtExceptionText` a test smyčkou 100 000 selhání proti `HEAPU8.length` |
| C9 | Fronta `SketchSession` uvázne, když job vyhodí synchronně. Job `toggleConstruction` není `async`, takže se `.finally` nespustí a `running` zůstane `true`. | `sketch-session.ts:237-251, 425-428` | kód | v `start()` obalit `job()` do `try/catch`, nebo `Promise.resolve().then(job)` |
| C10 | Lišta nástrojů přetéká: při šířce 700 px chybí „Výběr“ a „Zobrazit“ je useknuté. V režimu skici to nastává už pod ~950 px. | `Toolbar.vue:115-129` | prohlížeč | menu „…“ pro přetékající skupiny |
| C11 | Integrační testy (scénáře [[Topologické pojmenování\|topologického pojmenování]] s OCCT, planegcs, výkon a úniky handle) neběží v `npm run check`, i když trvají 1,7 s | `package.json:21` | fakt | přidat `test:integration` do `check` |

> [!note] Proč C1 vzniklo
> `backdrop-filter` (efekt skla) na předkovi dělá dvě věci. Je **containing blockem** pro potomky s `position: fixed`, takže se souřadnice menu počítají od rohu timeline, a ne od okna. A vytváří vlastní **stacking context**, takže `z-index: 100` dropdownu platí jen uvnitř lišty a nepřebije dialog. Menu Soubor funguje jen proto, že titulková lišta začíná v bodě (0, 0). Vue to řeší přes `Teleport`, který uzel v DOM přesune pod `body` a komponentu přitom nechá logicky na místě. E2E testují jen menu Soubor, proto to neodhalily.

## Architektura

### A1. Dva okamžiky stavu

Nejdůležitější téma revize. Tři projevy mají společný kořen: kód předpokládá, že model existuje v jednom okamžiku, ale ve skutečnosti jich existuje víc.

- **Generace (C6).** Index podtvaru platí jen se sítí, ze které vzešel. Kdo převádí index na jméno, musí mít index i tabulku jmen ze stejné generace. Diagram „Tok dat“ v [[01-architektura]] (`SceneSync.update(result)`) tenhle šev skrývá.
- **Vstupní vs. koncový stav (C4).**
  - [[Prezentační model|Dialog]] i skicář pickují a zvýrazňují nad koncovým stavem. [[Builder featury|Builder]] ale reference vyhodnocuje ve **vstupu** editované featury.
  - U Filletu proto vybraná hrana zmizí (je zaoblená) a klik na sousední hranu uloží jméno s id téže featury.
  - U skici na ploše se rovina bere z koncového stavu (`planeOfRef(lastState, …)`). Pozdější Transformace ji posune a pozdější Boolean, který těleso spotřebuje, způsobí `assert` a skica se neotevře ([[Rozhodnutí noční rychloakce|R108]] ⚠).
  - Blokuje to každou featuru, která mění tvar, na který sama odkazuje (shell, úkos, díra).
- **[[Transakce]] roste s každým snímkem tažení.** Každý výsledek řešiče a každý pohyb manipulátoru přidá krok s celými parametry a inverzí. Slučování (`merge`) proběhne až při `commit`. „Zrušit skicu“ po minutě tažení pak přehraje tisíce `replaceFeature` a u každého proběhne `changed`, validace a překreslení.

**Návrh (k rozhodnutí, nové ADR):**
- „Vstupní stav editované featury“. Stav před featurou už leží v cache Regeneratoru (`entries[i-1].state`). `RegenSnapshot` by nesl tělesa a jména vstupu editované featury a při aktivním referenčním parametru by se pickovalo a zvýrazňovalo nad nimi. Náhled výsledku by byl samostatná vrstva, jako v Onshape a Fusion.
- Generace: zveřejnit tělesa a jména až po `sync`.
- Transakce: slučovat sousední kroky už v `applyStep`, inverzi ponechat z prvního.
- **Levné kroky hned:** rovinu editované skici brát z `SketchArtifact.plane` a přidat čipy s × pro pole `topo` ([[Rozhodnutí noční rychloakce|R103]]).

### A2. Znalost „druhu reference“ je v ~11 paralelních switchích

Filtr pickingu, převod zásahu na referenci, zvýraznění, přijetí kliku z [[Prohlížeč|Prohlížeče]], čipy, validace a `referencesOf` mají každý vlastní `switch` podle `ParamSpec.kind`. Najdeš je v `ref-pick-tool`, `selection`, `feature-editor`, `browser-model`, `ref-values`, `document/validate`, `references`, `refs` a `ui/params/registry`.

Už teď se tabulky rozcházejí:
- `planes` je v `REF_KINDS` (jde fokusovat), ale nikdo ho nekonzumuje.
- Prohlížeč přijímá `bodies`, `region` i `axis`, ale ne `topo`.

Nový druh (vrcholy, `kind: 'feature'` pro vzory, konstrukční roviny) znamená drobné úpravy na mnoha místech a jedno se snadno zapomene („shotgun surgery“).

**Návrh:** v `interaction` jedna tabulka `RefKindBehavior` podle druhu (`pickFilter`, `fromHit`, `toggle`, `highlightTargets`, `browserAccepts`). V `document` obdobně pro validaci a `referencesOf`.

### A3. Kompoziční kořen a fasáda rostou

- **`createAppSession`** (`app/session.ts:262-705`) je jedna funkce o ~440 řádcích s 9 proměnnými `let`/`Map`. Obsahuje:
  - politiku restartu,
  - skládání `RegenUiState`,
  - čtyři ruční diffy téhož vzoru (`shownHidden`, `shownColors`, `shownPlanes`, `shownAxes`),
  - výběr kreseb skic,
  - `fitFirstView`,
  - `setViewDirection` při vstupu do skici,
  - `refuseChanges`.

  `openDocument` duplikuje `documents.createNewDocument` včetně konstanty `NAME_OF_NEW_DOCUMENT`. Kompoziční kořen se při přenosu na jinou platformu píše znovu ([[0009-platformove-nezavisla-domena|ADR 0009]]), takže se pravidla v něm přepíšou i s chybami. Testovat je jde jen přes celou session (`session.test.ts` má ~1300 řádků).
- **Fasáda `AppSession`** má od M12 o 13 členů víc:
  - Šest z nich jen přenáší konstanty (`actionIds`, `toolActionId`, `toolModes`…), protože `ui` smí z `interaction` jen typy.
  - Každé nastavení pohledu (barva, popisky view cube, režim otáčení) je metoda na čtyřech místech: `Viewport`, `AppViewport`, `AppSession` a fake.
  - `ui` dostává modely i s `dispose` a `actions.register`. Oprava z M15 (`Omit<…, 'dispose'>`) platí jen napůl.
- **Logika obrazovky mimo `interaction`:**
  - `ui/toolbar-groups.ts` (filtr podle režimu, povolení, pořadí),
  - `DocumentList.vue` (stav `busy`, `globalThis.confirm`, pořadí smazání a načtení),
  - zámek editace v `Timeline.vue:66-69, 89` místo ve `FeatureTreeModel`. `BrowserModel` totéž řeší správně v presenteru a [[10-interakce|spec 10]] si tu odporuje.

**Návrh:**
- Rozdělit session na `viewport-mirror.ts` (jeden obecný diff množin, `bindSceneView` vedle `bindSelectionHighlight`), `regen-pipeline.ts`, `open-document.ts` a `read-only.ts`. Session pak zůstane sestavením a fasádou (~200 řádků).
- Přidat `ToolbarModel` a `DocumentListModel` v `interaction`.
- Nastavení pohledu sjednotit do jednoho portu `ViewSettings`.
- Konstanty dávat `ui` přes vstupní bod jen s daty.

### A4. `interaction` jsou dva moduly

Skicář má asi 2000 řádků: `sketch-editor`, `sketch-session`, `sketch-actions`, `sketch-tools*` a `sketch-drawing`. Podle grafu importů ho uvnitř modulu nikdo jiný neimportuje. Poroste nejrychleji a směr závislostí dnes nic nehlídá.

Návrh:
- Vyčlenit `src/sketcher` jako prstenec 2 se závislostí na `interaction`.
- Manipulátory (~880 řádků) a dialog s referencemi nechat v podsložkách.
- `ToolManager` dnes zná konkrétní `ManipulatorController` a `createRefPick`. Ať místo nich dostane obecné `layers: InputLayer[]`.
- `render` nedělit, je to soudržný adaptér. Nanejvýš podsložky `camera/` a `view-cube/`.

### A5. Rozhraní širší, než je potřeba

Podle [[0011-programovani-proti-rozhranim|ADR 0011]] má spotřebitel dostat jen to, co používá. Porušení:
- **`ToolContext` dává nástrojům pluginů celý `ViewportPort`** (`tools.ts:23, 30`), tedy i `manipulators`, `sketches`, `project` a `events`. Nástroje přitom používají jen `pick`, `screenToRay`, `overlay` a `highlight`, a `ctx.ops` nevolá nikdo ([[Q069 Smí nástroj otevřít vlastní transakci|Q069]]). Je to bod rozšíření pro pluginy a zúžit ho jde jen teď, později už ne.
- **`interaction` zná jména parametrů pluginu skici** (`'plane'`, `'entities'`, `'constraints'` v `sketch-editor.ts:33`, `sketch-session.ts:146, 286`, `ref-values.ts:98`). ADR 0017 slibuje, že jedinou vazbou je `SKETCH_FEATURE_TYPE`. Návrh: `SketchParams` a konstanty jmen přesunout do modulu `sketch`.
- **Další široké závislosti:**
  - `tool-manager.ts:56` bere celý `ManipulatorController`,
  - `regenerator.ts:68` bere `GeometryKernel`, i když stačí `ModelingKernel & release`,
  - `sketch-editor.ts:36` bere celý `FeatureEditor`,
  - `Regenerator.events` vystavuje `emit` a vzor „pohled bez `emit`“ je pětkrát zkopírovaný (návrh: `emitter.asSubscribable()`).

### A6. Kontrakty jen v komentářích

Kontrakt, který není v typech, se poruší. Tady se to už jednou stalo (oprava 2026-10-14, viz [[Implicitní kontrakty první implementace]]).
- **[[Kotva manipulátoru|Kotvy]]**:
  - Jména kotev (`'base'`, `'pivot'`) jsou netypované řetězce mezi builderem a deskriptorem.
  - Builder featury s manipulátorem musí vrátit aspoň `{}`.
  - Featura v chybě kotvy nemá. Když tah featuru shodí, úchyty zmizí a tahem se nedá vrátit.
  - Návrh: `FeaturePlugin<P, A>` se sdíleným typem kotev; controller ať drží poslední známé kotvy session.
- **`ParamSchema` není svázané s `P`** (`schema.ts:110`), takže přejmenování parametru ve schématu bez úpravy rozhraní projde typecheckem. Pojistkou je mapovaný typ `{ readonly [K in keyof P]-?: ParamSpec }`.
- **`ui/manipulator-hud.ts:23-30` opisuje rozměry glyfů z `render/manipulator-pick.ts`.** Změna glyfu posune HUD a build to nezachytí.
- **Prahy skrytí glyfů (`render`) a prahy tahu (`interaction`).** Mezi moduly platí nepsaný invariant, že skrytí musí být přísnější než tah. Díky němu dnes nemůže nastat „klik na úchyt, který nejde táhnout“ (viz [[#Vyvrácené a nejisté nálezy]]), ale nic ho nehlídá.

### A7. Supervisor jádra a start

- **Ztracená příčina pádu.** `lost()` nedostane příčinu. Text „OCCT crashed: …“ se nikde neukáže a test dokonce vyžaduje `error === null` ve stavu `failed`.
- **Okno restartů.** Měří interval mezi dvěma pády, ne jejich četnost. Deterministický pád víc než 10 s po startu proto restartuje donekonečna.
- **Stav `failed`** je konečný, bez možnosti „zkusit znovu“.
- **Deterministický pád na jedné featuře** vede do smyčky restart → `failed` → reload. Nikde se nezaznamená, která featura právě běžela (`RegenEvents` v `app` nikdo neposlouchá).
- **Pořadí startu.** Jádro startuje uprostřed konstrukce session (`void start()` v kroku 4 ze 7). Když vyhodí krok 5–7, worker unikne. Kód navíc tiše spoléhá na pořadí deklarací (TDZ). WASM se začne načítat až po otevření IndexedDB. Otevření dokumentu jsem v prohlížeči měřil na 3–4 s.

**Návrh:**
- posuvné okno (3 pády za 60 s),
- `onError(cause)`,
- tlačítko „Zkusit znovu“,
- zapamatovat si featuru rozpracovanou při pádu a nabídnout její potlačení,
- `supervisor.start()` jako poslední krok,
- promise jádra vytvořit před `openDocument` (paralelní start).

### A8. Připravenost na proměnné ([[Q003 Proměnné a výrazy v parametrech|Q003]])

Parametry se čtou bez vyhodnocení na čtyřech místech: v Regeneratoru, ve `FeatureEditor`, ve `visibleWhen` a v manipulátorech (`toParams`). S výrazem `#h*2` by pole zmizelo a tah manipulátoru by výraz přepsal číslem. Návrh: jedna čistá funkce `evaluateParams(schema, params, variables)` v `document`. Dodatek k [[0006-nemenna-data|ADR 0006]] řeší jen cache.

### A9. Rozchod specifikace a kódu

- [[01-architektura]]:
  - „Tok dat“ popisuje `RegenResult` → `SceneSync.update(result)`, ve skutečnosti jsou to tři oddělené kanály (`publish`, `drawSketches`, `bodies.sync`).
  - „Kompoziční kořen“ dnes reálně tvoří `openAppSession` v `app/browser.ts`.
- [[10-interakce]]:
  - ř. 127 tvrdí, že se výběr po regeneraci čistí, kód ho přemapovává (R102),
  - tabulce modelů chybí `FeatureTreeModel.move`, `dependentsOf` a část `SketchSession`,
  - zámek editace je předepsaný do UI, což odporuje [[0010-prezentacni-model|ADR 0010]].
- [[11-ui]]:
  - ř. 164 tvrdí, že vybrané hrany ve Fillet dialogu jsou zvýrazněné (nejsou, C4),
  - ř. 181 tvrdí, že se zastaralý výsledek regenerace zahodí (publikuje se a tesseluje),
  - blok `AppSession` neobsahuje `kernelError`, `topoInspector` a `manipulator`.
- [[07-regenerace]] ř. 364 popisuje zahození `unknown-handle` v `render`, které v kódu není.
- **Obecně:** specifikace rostou jako changelog (odrážky „M12:“, „M14:“) a starší věty se nepřepisují. Jako kontrakt se tak čtou hůř: například `resolvePlane` v [[11-ui]] ř. 163 platí až po přečtení ř. 164.

## Kvalita a členění kódu

### Doména (`core`, `document`, `ops`, `persistence`, `regen`)

| Nález | Kde | Dopad | Jistota |
|---|---|---|---|
| Trvalé chyby úložiště (`not-found`, `invalid`, `seq-gap`) se opakují každých 5 s navždy. Export čeká na `flush`, takže selže přesně tehdy, kdy je úložiště rozbité. `storeErrorCode` a `exportDocument(doc)` existují, ale v produkci se nepoužívají. | `persistence/service.ts:151-170`, `app/file-exporter.ts:67-69` | práci nejde zachránit | pravděpodobné |
| Cache regenerace je klíčovaná identitou celé `FeatureInstance`, takže přejmenování nebo potlačení na stejnou hodnotu přepočítá všechny featury za ní (v OCCT) | `regenerator.ts:213`, `ops/handlers/feature.ts:156-158` | výkon | jisté |
| Property test „replay = živý dokument“ nemůže chytit špatnou inverzi: replay aplikuje tutéž inverzi | `ops/replay.property.test.ts:238-241` | falešná jistota | jisté |
| Vnořený `dispatch` z odběratele `appended` doručí události v opačném pořadí, přestože ho [[04-operace-a-historie\|spec 04]] povoluje | `ops/log.ts:64-69`, `dispatcher.ts:74-88` | latentní | jisté |
| `DocumentWriter.rename` je mrtvý kód a past (změna mimo log, `verify` pak selže) | `cad-document.ts:183-187` | latentní | jisté |
| Kontrola kontraktu storu je zkopírovaná v paměťovém i IDB storu | `memory-store.ts:84-136`, `idb-store.ts:109-187` | údržba | jisté |
| Handlery `body.*` skládají metadata po polích, takže nové pole se při skrytí tiše smaže | `ops/handlers/body.ts:34-62` | budoucí chyba | jisté |
| `loadDocument` nekontroluje řetěz undo/redo, `importDocument` ano. Export proto projde, ale import téže zálohy selže. | `persistence/load.ts:37-72` | záloha nejde obnovit | jisté |
| `isRecord` je napsaný 11×. Nepoužité exporty: `upcastOperation`, `storeErrorCode`, `exportDocument`, `vec3.equals`, `mat4.identity` | různé | úklid | jisté |

### Geometrie (`kernel`, `kernel-occt`, `sketch`, `solver-planegcs`)

| Nález | Kde | Dopad | Jistota |
|---|---|---|---|
| **FakeKernel dává falešnou jistotu.** `makeFace` ignoruje díry a samoprotnutí, extrude ve směru roviny projde, `subtract` vrací vždy cíl, fillet přijme jakýkoli poloměr a topologie je vždy kvádr 6/12/8. | `kernel/fake-kernel.ts` | testy nad fake projdou, prohlížeč selže | jisté |
| Fillet a chamfer tiše vynechají hranu, kterou OCCT nezpracuje: `ChFi3d_FilBuilder::Add` je `void` a `Contour(edge)` se nekontroluje | `kernel-occt/dressup.ts:31-38` | zaoblí se 2 ze 3 hran a hlásí úspěch | jisté (vynechání) |
| Boolean nekontroluje platnost výsledku (`BRepCheck_Analyzer`), ignoruje varování, nedestruktivní režim je vypnutý (smí změnit tolerance vstupů v cache) a `union` nemá `UnifySameDomain` | `occt-kernel-impl.ts:512-539` | chyba se projeví až o featuru dál | domněnka |
| Tolerance skica → řešič → jádro nesedí. Uzly oblastí se slučují jen podle souřadnic (vazby `coincident` se nečtou), uzavřenost smyčky je relativní 1e-7 proti absolutní v OCCT a poloměr oblouku je 1e-6 v `parse` proti 1e-7 v `profile`. | `sketch/regions.ts:83-93`, `kernel/profile.ts:40-42`, `sketch/parse.ts:15` | oblast tiše zmizí | nesoulad jistý, dopad domněnka |
| `isWasmTrap` je úzký: přetečení zásobníku je `RangeError`, ne `RuntimeError`, a nerozbaluje `SuppressedError` z `using` | `kernel-occt/wasm-trap.ts:11-16` (+ kopie v solveru) | poškozené jádro běží dál | pravděpodobné |
| Validace je zkopírovaná mezi fake a OCCT (konstanty i kontroly), `FaceInput` je deklarovaný dvakrát. Soubory mají 584 a 763 řádků. | `occt-kernel-impl.ts`, `fake-kernel.ts` | drift (`makeBox` ≤ 1e-7 vrací `internal` místo `invalid-input`) | jisté |
| Atomický `release`: jeden neznámý handle trvale rozbije regenerátor | `occt-kernel-impl.ts:307-320`, `regenerator.ts:188-193` | design | jisté |
| `mapSubShapes`, `topologyOf` a `collectHistory` jsou O(n²) přes `IsSame`, i když build má `HashCode` | `occt.ts:43-74`, `topology.ts:15-29` | sekundy u 1000 ploch | jisté |
| `solveSketch` polyká všechny výjimky jako `failed` bez důvodu a `GcsSystem` unikne, když vyhodí konstruktor wrapperu | `solver-planegcs/solve.ts:36-44` | diagnostika | jisté |

### `interaction`

| Nález | Kde | Dopad | Jistota |
|---|---|---|---|
| Úklid při zavření není odolný vůči výjimce odběratele: `refresh()` je před `onClose()`. `editor.current` pak zůstane na zavřené session a další dialog do reloadu nejde otevřít. | `feature-editor.ts:380-391`, `sketch-session.ts:215-222`, `sketch-editor.ts:58-61` | zámek UI | jisté, vzácné |
| Náhledová regenerace (přechodný posun baru, Boolean) trvale zahodí výběr ploch a hran | `selection.ts:140-142`, `feature-editor.ts:200-211` | ztráta výběru | pravděpodobné |
| `finish()` skicy nečeká na frontu řešiče, takže obdélník a hned „Hotovo“ geometrii tiše ztratí | `sketch-session.ts:304, 465` | ztráta práce | pravděpodobné |
| `readData()` vrací pro neplatná data `EMPTY_DATA` a další změna přepíše celou skicu | `sketch-session.ts:144-148` | ztráta dat | domněnka |
| Neošetřená odmítnutí promisů v nástrojích skicáře (`void …`) | `circle-tool.ts:43`, `rectangle-tool.ts:68`… | tichá chyba | pravděpodobné |
| `ManipulatorController.setValue` nekontroluje `Number.isFinite` (hlídá jen `ui`) | `manipulator-controller.ts:384-391` | vstup do C5 | jisté |
| Duplicity: odvozený `Observable<boolean>` 5×, `sameIssues` 2×, průsečík paprsku s rovinou 3×, `arcPoints` 2× (s jiným chováním) | různé | údržba | jisté |
| Velké soubory se dají rozdělit podle odpovědnosti: `manipulator-controller` (matematika tahu do `manipulator-drag`, pohledy a HUD do `manipulator-views`, zbude ~300 řádků), `browser-model` (stavitele řádků), `sketch-session` (`SerialQueue`, `sketch-state`), `feature-editor` (čistá `buildEditState`) | — | čitelnost | jisté |

### `render`

| Nález | Kde | Dopad | Jistota |
|---|---|---|---|
| Během orbitu nebo panu kamerou se dál posílá `move`, takže každý snímek spustí picking manipulátorů i modelu a přestaví hover | `viewport.ts:467-469` | výkon, blikání hoveru | jisté |
| Pixel ratio se nastaví jen při `mount`, takže po zoomu stránky nebo přesunu okna na jiný monitor je obraz rozmazaný | `viewport.ts:439` | vzhled | jisté |
| Picking hran alokuje objekt na každý segment při každém pohybu myši a zakrytí testuje raycastem pro každého kandidáta | `picker.ts:81-109` | GC, výkon | jisté |
| Hover přestaví i celé zvýraznění výběru (u tělesa O(F²) přes `findRange`) | `highlight-layer.ts:85-91`, `mesh-index.ts` | výkon | jisté |
| Jedno `NaN` v kresbě nebo overlayi vede přes `sceneBounds` a `clipRange` k prázdnému viewportu. `manipulator-layer.set` přidá glyf do scény před `place`, takže výjimka nechá „ducha“. | `bounds.ts`, `camera-ops.ts:199-210`, `manipulator-layer.ts:319-337` | prázdné okno | pravděpodobné |
| Zrušená animace v turntable nechá roll (slerp) | `camera-controller.ts:128-134, 234-240` | nakloněný pohled | pravděpodobné |
| Výplň oblasti se kreslí nad čarami skici: `renderOrder` řadí jen uvnitř jedné fronty (opaque/transparent) | `sketch-layer.ts:99-105` | proti spec 09 | jisté |
| Po obnovení kontextu WebGL se nic nepřekreslí | `viewport.ts:438-448` | prázdné okno | pravděpodobné |
| `viewport.ts` má 5 odpovědností. `setResolution` u `LineMaterial` se volá ručně po vrstvách (zapomenutá vrstva má neviditelné čáry). Tvar glyfu je definovaný dvakrát. | — | údržba | jisté |

### `app` a `features/*`

| Nález | Kde | Dopad | Jistota |
|---|---|---|---|
| Výjimka regenerace skončí jen v `console.error`. Odběratel, který vyhodí v `publish`, zastaví i kreslení těles. | `session.ts:431-465` | tichý zastaralý model | jisté |
| Zastaralý výsledek se publikuje a tesseluje (scheduler běží sériově, `superseded` nikdy nenastane), takže při tahu se tesseluje dvakrát | `session.ts:446-464` | latence tahu | jisté v kódu |
| Chyby jádra jsou nepřeložené a bez vazby na parametr („fillet: the algorithm failed“) a u `INVALID_PARAMS` se zpráva v tooltipu zobrazí dvakrát | `regenerator.ts:137`, `kernel-occt/dressup.ts:46-69`, `TimelineItem.vue:81` | uživatel neví, co změnit | jisté |
| Po restartu jádra drží `lastState` handly mrtvého jádra, takže export může poslat starý handle novému jádru (v horším případě vyexportuje cizí těleso) | `session.ts:313, 418-422` | špatný export | pravděpodobné |
| Oblasti z různých skic se vysunou směrem normály první oblasti | `features/extrude/builder.ts:47-52` | chyba KERNEL nebo šikmý hranol | pravděpodobné |
| **Duplicity v pluginech:** `tool.ts` 8× téměř shodný, builder fillet ≡ chamfer, střed obálky v transform ≡ extrude, nové těleso v box/cylinder kopíruje `applyBodyOperation`, parametry `operation` a `targets` v extrude ≡ revolve | `features/*` | každá další featura je kopie | jisté |
| Symetrické vysunutí přichytává polovinu vzdálenosti (krok 2 mm, minimum 0,02) | `features/extrude/manipulators.ts:21, 44-47` | drobnost | jisté |
| `Transform.migrate` hledá osu v prototypu objektu (`'constructor'`) | `features/transform/schema.ts:89-93` | jen poškozený soubor | jisté |

Návrh pro pluginy: `createDialogTool` v `plugin-api`, `dressUpBodies`, `boundsOf`, `resolveTargets` a `bodyOperationParams` v `regen`. Precedent je `modifyBody`.

### `ui` (kód)

- **CSS „skleněného“ panelu** je zkopírované v 8 komponentách a `.button` ve 3. Návrh: `base.css` s třídami `.panel`, `.btn`, `.icon-btn`, `.field-control`.
- **`Browser.vue`:**
  - tři téměř shodné řádky složek,
  - tři tlačítka oka,
  - inline přejmenování skoro shodné s `TimelineItem.vue` (návrh: `useInlineRename`, `VisibilityToggle`, `BrowserSection`).
- **Chybí `app.config.errorHandler`.** Výjimka v renderu skončí jen v konzoli.
- **Pravidlo „additive klik“** je třikrát a `Timeline.vue` hledá položky přes `querySelectorAll('.timeline-item')` cizí komponenty.
- **Dobře:** reaktivita je čistá (`useObservable` + `shallowRef`), klíče překladů cs/en sedí 1:1 a nikde nejsou barvy natvrdo.

## Testy

| Nález | Kde | Dopad |
|---|---|---|
| Integrační testy nejsou v `check` (C11) | `package.json:21` | rozbité pojmenování hran projde |
| Testy pickeru kontrolují jen `kind: 'edge'`, ne kterou hranu. Fixture má jednosegmentové hrany, takže `edgeIndex` = index segmentu. | `render/picker.test.ts:62-121` | zaoblí se jiná hrana a test projde |
| „Ten quick changes regenerate at most twice“ projde i s nula běhy nebo se zastaralým výsledkem (jen horní mez) | `app/session.test.ts:281-297` | zastaralý model projde |
| Požadavek během **neúspěšného** běhu scheduleru se netestuje | `regen-scheduler.test.ts:57-76` | ztracený přepočet projde |
| Uvolňování GPU zdrojů a stavová vrstva `render` (viewport, kamera, manipulátory, view cube) nemají testy. E2E na plátně netáhnou, nepoužívají kolečko ani manipulátor. | `render/*` | únik GPU paměti projde |
| `ConstraintSolver` a `ViewportPort` nemají kontraktové sady. `FakeSolver` vždy vrací `ok`, `sketch-tools.test` má vlastní pick (1 px místo 6 px). | `sketch/testing.ts`, `interaction/testing.ts` | fake se rozejde s adaptérem |
| `regions.ts`: větev oblouku v `contains` se nikdy nespustí, `arcsOverlap` netestuje nic a property testy chybí | `sketch/regions.ts:356-386, 500` | díra v drážce dá plné těleso |
| Kompatibilita formátu se netestuje proti zmrazeným souborům (golden master) | `persistence` | nechtěná změna formátu projde |
| `toBeCloseTo` bez přesnosti (±0,005) na ~70 místech | `camera-math.test.ts` aj. | slabé aserce |
| Opakovaný setup: 6× `aRecordingKernel`, 7× `settle`, kopie schématu skici se odchýlila; spec 13 popisuje jiné API builderů | různé | údržba |

**Top 10 chybějících testů** (podle rizika):
1. Integrační test hlavního parametrického toku: zaoblení hrany vysunutého obdélníku přežije změnu kóty skici, undo a reload. Dnes není na žádné úrovni.
2. Picker na hraně z více segmentů vrátí správné `body`, `edgeIndex` a `point` a nevybere zakrytou hranu.
3. Regenerace dožene poslední stav: rychlé úpravy, požadavek během selhaného běhu, pád jádra uprostřed.
4. Invariant „živé geometrie = geometrie ve scéně“ po `sync`, `reset` a hoveru (`trackDisposal` v `render/testing.ts`).
5. Oblasti skici: díra v drážce, úsečka křížící oblouk, souřadnice ~1e6 a property test invariance vůči posunu, měřítku a pořadí entit.
6. Fronta `SketchSession`: job, který vyhodí (C9), a zrušení s čekajícím jobem.
7. `describeConstraintSolverContract` nad `FakeSolver` i planegcs.
8. Kamera: po `setView`, `resize` a zoomu leží obálka modelu v NDC.
9. E2E: tah manipulátoru → OK → undo → reload, klik na view cube a kontextové menu timeline (C1).
10. Golden soubor: zmrazený export se načte na očekávaný `toData`.

**Co je dobře:**
- Kontraktové sady `GeometryKernel` a `DocumentStore` pokrývají chybové cesty a běží proti fake, OCCT i klientovi přes `MessageChannel`.
- Čas a plánovač se injektují.
- Property testy jsou tam, kde mají největší cenu (replay logu, regenerace proti regeneraci od nuly).
- Mocků je minimum.
- `persistence/service.test.ts` je vzorový.
- E2E fixture shodí test při chybě v konzoli.

## UI a UX

### Co funguje (ruční průchod)

- **Hlavní tok** skica → kóta → vysunutí → zaoblení → úprava vysunutí funguje a zaoblení přežije změnu výšky z 26 na 40 mm. [[Topologické pojmenování]] tedy drží i ručně.
- **[[Manipulátor]] vysunutí:** tah šipky s polem hodnoty, Enter v poli potvrdí dialog, Esc dialog nezavře.
- **Dialog featury:**
  - jde přesunout,
  - při úpravě se rollback bar posune za featuru,
  - tooltipy ukazují zkratky a „Závisí na ní: 1“.
- **Undo, panel historie a přepínání tématu a jazyka** fungují bez reloadu.

### Nálezy

| # | Nález | Kde | Zdroj |
|---|---|---|---|
| U1 | Selhání ukládání je jen 7px červená tečka. `role="status"` bez textu nic neohlásí a uživatel pracuje dál bez ukládání. | `TitleBar.vue:105-112` | kód |
| U2 | Dialog featury neukáže chybu regenerace ani issue bez pole, důvod je jen v hover tooltipu položky timeline | `FeatureDialog.vue:27, 105-119` | kód + průchod (C4) |
| U3 | Klávesnice: položky timeline (`role="button"` bez `tabindex`) a strom Prohlížeče se ovládají jen myší. `ContextMenu` nemá správu fokusu. Tlačítko Smazat dokument je `display: none`, takže je nedostupné z klávesnice i na dotyku. Tooltipy se ukážou jen při hoveru. | `TimelineItem.vue:50-59`, `Browser.vue`, `DocumentList.vue:300-315` | kód |
| U4 | Dokumenty nejdou přejmenovat. Seznam ukazuje třikrát „Bez názvu“ se stejnou ikonou a bez náhledu, takže jsou k nerozeznání. | `TitleBar.vue:42` | průchod |
| U5 | Nový dialog vysunutí hned zčervená v timeline („Chyby: 1“), ještě než uživatel něco zadá. Jedinou oblast skici nevybere sám. | — | průchod |
| U6 | Kamera poskočí uprostřed prvního dialogu: `fitFirstView` se spustí u prvního tělesa, a tím je náhled v dialogu vysunutí | `session.ts:466-474` | průchod |
| U7 | Skica se kreslí přes tělesa (`depthTest: false`, [[Rozhodnutí noční rychloakce\|R47]] ⚠). Zadní hrany skici prosvítají tělesem, výplň oblasti přebarví celé těleso a picking skici ignoruje zakrytí. | `sketch-layer.ts:104, 111, 332` | průchod |
| U8 | Kóta ukazuje `83.523654` a ve viewportu se nekreslí (jen v panelu). Mřížka vypadá jako přichycení, ale hodnoty nejsou kulaté. Pole nemá `aria-label`. | `SketchPanel.vue` | průchod |
| U9 | Po výběru zmizí hláška „Vyberte aspoň 1“ a pole poskočí o řádek, takže se další klik trefí jinam | `FeatureDialog.vue` | průchod |
| U10 | Dialog featury a panel historie zakrývají view cube. Menu „Zobrazit“ nabízí jen „Zobrazit vše“ a standardní pohledy jsou jen na zakryté kostce. | — | průchod |
| U11 | Stav jádra `starting` se nezobrazí (prázdný viewport bez vysvětlení). Seznam dokumentů po chybě načtení zůstane na „Načítám…“. | `TitleBar.vue:115-134`, `DocumentList.vue:31-37` | kód |
| U12 | Hlášky jádra jsou anglicky a se syrovými jmény. Tooltip chyby přetéká přes okraj okna. Podrobnosti chyb jsou jen v `title`. | `TimelineItem.vue`, `TitleBar.vue` | průchod + kód |
| U13 | V tmavém režimu má těleso výchozí modrou barvu ve stejném odstínu jako výběr, takže vypadá vybrané | — | průchod |
| U14 | Výchozí jména featur se ukládají v jazyce vytvoření („Skica 1“ v anglickém UI), jména těles se překládají živě | — | průchod |
| U15 | Timeline nemá přetečení: při ~25 featurách zajede pod stavový řádek | `Timeline.vue:225-231` | kód |
| U16 | Kontrast pod WCAG AA (`--text-tertiary` 2,6:1, `--danger` 3,5:1) na průsvitných panelech. `<html lang>` je napevno `cs`. | `tokens.css`, `index.html:2` | kód |
| U17 | „Rotace“ znamená v liště Revolve a zároveň režim manipulátoru | i18n | průchod |
| U18 | View cube spolkne kolečko a pravé tažení v celém čtverci 132×132 px („mrtvý roh“) | `view-cube.ts:316-325` | kód (domněnka) |

## Vyvrácené a nejisté nálezy

- **Vyvráceno: „klik na úchyt, který nejde táhnout, propadne do spodní vrstvy“.** Recenzent `interaction` tvrdil, že šipka vysunutí v pohledu kolmo na skicu odebere oblast pod sebou. Prahy skrytí glyfů v `render` jsou ale přísnější než prahy, od kterých tah vrací `null`:

  | Glyf | Skryje se (`render`) | Tah vrací `null` (`interaction`) |
  |---|---|---|
  | šipka | 0,98 | 0,999 |
  | kružnice a čtverec | 0,05 | 0,02 |

  Úchyt, který jde trefit, jde tedy vždy i táhnout. Ten invariant ale nikde nevynucují typy (A6).
- **Latentní (dnes nic nespouští):**
  - vnořený `dispatch` z `appended`,
  - `applyTransient` se strukturální operací,
  - vyhazující odběratel `busy` v `RegenScheduler`,
  - atomický `release`.
- **Domněnky k ověření měřením nebo pokusem:**
  - platnost výsledku booleanu v OCCT,
  - blikání plátna při změně velikosti,
  - přesnost `Float32` u modelů nad 10 m,
  - růst logu (změřit `loadDocument` pro 5000 záznamů),
  - ztráta až 300 ms práce při zavření záložky.

## Stav revize 2026-10-13

| Nález | Stav |
|---|---|
| 1 Artefakty | vyřešeno ve stavu, v portu jen částečně (R38: zvlášť `bodies` a `sketches`) |
| 2 Identita tělesa | částečně: rodokmen, `bodyId` a metadata ano, rozpad booleanu na víc těles je třikrát odložený (R8, R100, R132) |
| 3 Reference a graf | vyřešeno, chybí jen `kind: 'feature'`; `topo` závisí jen na vlastníkovi tělesa (R110) |
| 4 Migrace v logu | vyřešeno a ověřeno na Transformaci v3 |
| 5 Výběr podle jmen | funkčně vyřešeno, ale nově C6 (generace) |
| 6 Režimy | vyřešeno |
| 7 `ParamSpec` | vyřešeno |
| 8 Cache a proměnné | zdokumentováno, viz A8 |
| 9 Profil jako handle | vyřešeno |
| Menší: `AppViewport` opisuje `Viewport` | nevyřešeno a rozrostlo se (A3) |
| Menší: stav „odvozeno z chyby“ v Timeline | nevyřešeno |

Revize 2026-10-13 tím je zpracovaná a dá se archivovat.

## Co drží a nemá se měnit

- **Featura jako plugin**, registry a schémata. Fillet vznikl bez zásahu mimo `features/`.
- **Tři prstence vynucené nástrojem**, porty u spotřebitele a [[Kontraktové testy portu|kontraktové sady]] proti fake i skutečnému adaptéru.
- **Pořadí zpráv workeru jako záruka:** tessellace se odešle synchronně v `sync` a úklid handle tak nikdy nepředběhne čtení.
- **Správa paměti OCCT:** `using` a `delete` na všech cestách. Únik se našel jen u výjimek (C8).
- **Stav kamery jako čistá hodnota** (`camera-ops`, `camera-model`) a near/far z obálky všeho viditelného.
- **Manipulátory přes deskriptor a kotvy:** controller neví nic o Transformaci a matematika lensů (pivot, kardanový rámec) sedí.
- **Jediné místo, které drží transakci** (`FeatureEditor`), takže undo, Zrušit a slučování v logu fungují zadarmo.
- **Topologická jména** jako čistá funkce nad historií jádra.

## Doporučené pořadí

Návrh k rozhodnutí s Pavlem:

1. **Milník oprav `M19.1`** (podle [[Konvence vaultu#Principy|konvence MNN.X]]) pro ověřené chyby a robustnost. Jde o malé a jasné úkoly bez nového návrhu:
   - C1–C3, C5, C7–C11,
   - trvalé chyby úložiště a export živého dokumentu,
   - viditelná chyba regenerace a ukládání (U1, U2),
   - supervisor (příčina, okno, „Zkusit znovu“),
   - úklid při zavření v `try/finally`,
   - `lastState` po restartu,
   - stav jádra `starting`.
2. **Rozhodnutí před další featurou** (otázky, ADR):
   - A1 (vstupní stav editované featury, generace, slučování kroků transakce), která zároveň opraví C4 a C6,
   - A6 (typované kotvy),
   - A2 (`RefKindBehavior`).
3. **Úklid struktury:**
   - rozdělení `session.ts`,
   - `ToolbarModel`, `DocumentListModel`,
   - modul `sketcher`,
   - pomocníci pluginů (`createDialogTool`, `dressUpBodies`),
   - zúžení `ToolContext`,
   - jména parametrů skici v `sketch`.
4. **Testy** podle seznamu Top 10 a kontraktová sada řešiče.
5. **UX backlog:**
   - přejmenování dokumentů,
   - klávesnice a přístupnost (U3, U16),
   - znovu otevřít R47 (skica přes tělesa),
   - zobrazení kót ve viewportu,
   - přetečení lišty a timeline.
