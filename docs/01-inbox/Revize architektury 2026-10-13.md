---
type: note
tags:
  - inbox
created: 2026-10-13
updated: 2026-10-13
---
# Revize architektury 2026-10-13

Nezávislá revize kostry tinycad po [[M10-ui|M10]] (Claude na Pavlovu žádost). Nehledá porušení ADR (to dělá `architecture-reviewer`), ale místa, kde návrh **časem začne bránit rozšiřování** směrem k Onshape Part Studiu a Fusion 360. Každý nález je kandidát na otázku v `60-otazky/` nebo na ADR; nic z toho se nerozhoduje tady.

> [!note] Plán oprav
> Nálezy mají plán v milníku [[M10.1-zpevneni-kostry]] (nálezy 1–5, 8 a stažené drobnosti) a jako úkoly v [[M11-dalsi-entity|M11]], [[M12-skicar|M12]], [[M13-extrude-revolve|M13]] a [[M14-topologicke-pojmenovani|M14]] (nálezy 6, 7, 9 a druhá část 5).

Měřítko: co bude potřeba v [[M11-dalsi-entity|M11]] (Transform, Boolean), [[M12-skicar|M12]] (skica), [[M13-extrude-revolve|M13]] (Extrude), [[M14-topologicke-pojmenovani|M14]] (topologické pojmenování) a dál (proměnné, vlastnosti těles, vzory, více Part Studií).

## Co drží a nemá se měnit

- **Tři prstence a hranice vynucené nástrojem** (`tsconfig.domain.json`, dependency-cruiser). Doména opravdu běží v Node; `createAppSession` má 50+ testů bez prohlížeče.
- **Porty s kontraktovými sadami** (`GeometryKernel`, `DocumentStore`, `ViewportPort`, `RegenStatusPort`). Fake i skutečný adaptér procházejí stejnou sadou, to je nejlepší pojistka proti „implicitním kontraktům první implementace“.
- **Recept + neměnná data + cache podle identity** ([[0003-dokument-je-recept|ADR 0003]], [[0006-nemenna-data|ADR 0006]]). Stejný model jako Onshape: lineární přehrání od první změny, červená featura nerozbije zbytek.
- **Operační log s inverzemi, transakce, replay test** ([[0005-operacni-log|ADR 0005]]). Dialog = jeden záznam, undo přežije reload, determinismus hlídá property test.
- **Handle místo tvarů, mark & sweep, generace** ([[06-geometricke-jadro]], [[07-regenerace]]). Souběh regenerace, tessellace a restartu jádra je promyšlený a otestovaný.
- **Prezentační modely nad `Observable`** ([[0010-prezentacni-model|ADR 0010]]): Vue komponenty jsou opravdu jen vazby.
- **Plugin = schéma + builder + nástroj + slovník**: Box se registruje jedním řádkem a UI o něm neví.

Kostra je zdravá. Nálezy níže jsou o tom, co kostře **chybí**, ne o tom, co je špatně.

## Nálezy podle závažnosti

### 1. Stav regenerace zná jen tělesa; skica, roviny a osy nemají kam

**Kde:** `src/regen/state.ts` (`RegenState { bodies }`), `src/regen/builder.ts` (`BuildInput { feature, state }`, `resolveBodies`), `src/interaction/regen-status-port.ts` (`RegenSnapshot.bodies`), `src/render/scene-sync.ts` (`sync(bodies)`), [[Prohlížeč]].

**Proč to bude bolet:** [[12-skicar|Skica]] žádné těleso nevytváří, ale Extrude potřebuje její profily a rovinu. Builder vidí jen `feature` a `state`, ne parametry jiných featur, takže skica musí svůj výsledek (vyřešenou geometrii, oblasti, rovinu) **publikovat do stavu**. Dnes tam není slot. Totéž platí pro konstrukční roviny, osy a body (Fusion: skupina *Construction*, Onshape: *Plane*, *Mate connector*), pro křivky a plochy (surfaces) a pro vzory. [[Prohlížeč]] ve Fusion ukazuje *Bodies, Sketches, Construction, Origin*; náš ukazuje jen tělesa, protože port nic jiného nenese. Render umí vykreslit jen tělesa; skica mimo režim editace (Onshape i Fusion ji kreslí) nemá kanál.

**Návrh:** zobecnit [[Stav regenerace|stav regenerace]] na **artefakty**: `RegenState.artifacts: ReadonlyMap<ArtifactId, Artifact>`, `Artifact = Body | SketchArtifact | PlaneArtifact | AxisArtifact | PointArtifact` (diskriminace podle `kind`). `EntityRef.kind` z [[03-dokument]] mapovat 1 : 1 na druhy artefaktů, `resolveBodies` → `resolve(refs)`. [[Těleso]] zůstane jedním druhem. Render: místo `viewport.bodies.sync(bodies)` kanál `sync(artifacts)` s vykreslovačem podle druhu (tělesa, křivky skici, roviny jako průhledné obdélníky), nebo samostatné vrstvy. Port `RegenStatusPort` nese artefakty, Prohlížeč je seskupí podle druhu.

**Bonus:** počáteční roviny XY/XZ/YZ a osy jako artefakty implicitní featury „origin“ (Fusion *Origin*, Onshape *Default geometry*). Pak `plane: 'XY' | TopoRef` ze [[12-skicar|spec 12]] není sjednocení enumu a reference, ale obyčejná reference na artefakt `origin/plane:xy`.

**Kdy:** rozhodnout před [[M12-skicar|M12]], ideálně už při Booleanu v [[M11-dalsi-entity|M11]], kde se poprvé ptáme „která tělesa zanikla“.

### 2. Identita tělesa je konvence v builderu, ne pravidlo

**Kde:** `src/features/box/builder.ts` (`` `${feature.id}/body` as BodyId ``), `src/regen/state.ts` (`Body.createdBy`), plán M11 („výsledek Booleanu dědí `BodyId` prvního cíle“, „Transform si ponechá `BodyId`“), [[Q071 Viditelnost těles|Q071]].

**Proč to bude bolet:** formát `BodyId` není nikde vynucený, pravidlo pro featury s více výstupy (`:<n>` podle pořadí z jádra) je **nestabilní** stejně jako indexy ploch, jen o úroveň výš: OCCT může po změně parametru vrátit solidy v jiném pořadí a „Těleso 2“ se tiše stane „Tělesem 1“. Po Booleanu/Transformu je `createdBy` dvojznačné (kdo těleso vytvořil, a kdo ho naposledy změnil). Fusion ukládá k tělesům jméno, barvu a viditelnost do dokumentu; Onshape má *part properties* nad trvalou identitou dílu. U nás to nemá kam (Q071 to už narazilo a vyřešilo jen stavem pohledu).

**Návrh:**
- Identita tělesa = **rodokmen**: `Body { id, origin: FeatureId, lastModifiedBy: FeatureId, shape, names }`. Pořadové číslo u více výstupů odvozovat z historie jádra (`Generated`/`Modified` pro solidy: „vzniklo z tělesa X“), ne z pořadí výstupu.
- Jeden pomocník `bodyId(origin, n)` v `document`, builder přetypování nedělá.
- Místo pro metadata tělesa v dokumentu: `PartStudioData.bodies?: Readonly<Record<BodyId, { name?, color?, hidden? }>>` měněné operacemi `body.rename`, `body.setVisible`… Dokud identita není rodokmen, metadata se nedají bezpečně uložit.

**Kdy:** [[M11-dalsi-entity|M11]] (Boolean a Transform ji definují poprvé).

### 3. Reference se nedají vyjmenovat, graf závislostí neexistuje

**Kde:** `src/document/schema.ts` (`ParamSpec` zná referenční druhy, ale `document` nemá `referencesOf`), `src/ops/handlers/feature.ts` (`feature.move` bez kontroly), `src/interaction/builtin-actions.ts` (`feature.delete` bez varování), [[Q013 Graf závislostí featur|Q013]], [[Q003 Proměnné a výrazy v parametrech|Q003]].

**Proč to bude bolet:** jakmile v M11 Boolean odkazuje na kvádr, jde featuru **přesunout před její závislost** (`feature.move` to přijme, regenerace skončí `UNRESOLVED_REFERENCE` bez vysvětlení) a **smazat kvádr bez varování** (Onshape i Fusion varují, co se rozbije). Potlačení featury nepropaguje. Bez grafu nejde ani „zvýrazni, co na featuře závisí“, ani chytřejší invalidace, ani proměnné (viz 8).

Druhá polovina: `ParamSpec` zná reference jen jako **pole na nejvyšší úrovni**. Extrude má `upTo: TopoRef | null` (jedna), skica `plane: PlaneRef` (sjednocení), vzor odkazuje na **featury** (`EntityRef` nemá `kind: 'feature'`).

**Návrh:**
- Čistá funkce `referencesOf(schema, params): readonly EntityRef[]` v `document`, řízená `ParamSpec` (včetně jednotlivé reference a vnořených objektů).
- `dependencies(studio, schemas): ReadonlyMap<FeatureId, readonly FeatureId[]>` (reference → vlastník přes `origin` artefaktu).
- Pravidla v `interaction` (prezentační logika): `moveRollbackBar`/přesun featury odmítne pořadí, které poruší závislosti; `feature.delete` ukáže, kolik featur ztratí referenci (jako Fusion). Handler `feature.move` může kontrolu dělat také, ale pak `ops` potřebuje schémata.
- `EntityRef` doplnit o `kind: 'feature'` (vzory, derived) a `kind: 'plane' | 'axis' | 'point'` (konstrukce, viz 1).

**Kdy:** [[M11-dalsi-entity|M11]], protože reference na tělesa jsou jeho obsah.

### 4. Migrace parametrů featur v logu je časovaná bomba (Q035)

**Kde:** `src/ops/operation.ts` (`FeatureSetParamsOp` **nemá `typeVersion`**), `src/persistence/load.ts` (`fromData` migruje snapshot, `replayLog` aplikuje záznamy beze změny), [[05-persistence#Načtení dokumentu]] („známé omezení“), [[Q035 Migrace featur v záznamech logu|Q035]].

**Proč to bude bolet:** první schéma s `version: 2` (třeba Box s novým parametrem `centered`) rozbije **každý uložený dokument**: snapshot se zmigruje, ale záznamy po snapshotu (a `inverse` pro undo) nesou staré parametry. Po načtení jsou v dokumentu featury se starým `typeVersion` a starými parametry, [[Regenerace|Regenerator]] „předpokládá aktuální verzi“ a builder čte parametr, který neexistuje. `verify` to **nechytí**: obě cesty přehrání migraci přeskočí stejně. U `setParams` navíc ani nejde poznat, jaké verze parametry jsou.

**Návrh (rozhodnout teď, dokud jsou všechna schémata v1):**
- `feature.setParams` dostane `typeVersion` (zvednout `OP_VERSION`, první skutečný `upcast`, dobré cvičení).
- Migrace na hranici: `parseLogEntry` dostane `schemas` (`ops` na `document` už závisí) a zavolá `schema.migrate` na `feature.add.feature` i `feature.setParams.params`, v `op` i `inverse`.
- Test: dokument v1 + log → načtení se schématem v2 → každá featura má `typeVersion` 2 a undo funguje.

**Kdy:** před prvním zvednutím verze schématu; dnes levné, později drahé.

### 5. Výběr, picking a zvýraznění stojí na indexech a port nenese jména

**Kde:** `src/interaction/selection.ts` (`faceIndex`/`edgeIndex`), `src/interaction/viewport-port.ts` (`PickResult`, `HighlightTarget`, `pick(x, y)` bez filtru), `src/interaction/regen-status-port.ts` (jen `health` a `bodies`), `src/interaction/ref-pick-tool.ts`, [[Q064 Výběr po regeneraci|Q064]].

**Proč to bude bolet:** dialog má živý náhled, takže každé `setParam` regeneruje a podle Q064 **vymaže výběr ploch a hran**. Ve fillet dialogu (M14) uživatel vybere hranu, změní poloměr a výběr zmizí. `RegenStatusPort` nenese tabulky jmen, takže `interaction` nemá jak převést pick na `TopoRef` ani jak výběr po regeneraci přemapovat. Typy s indexy jsou rozsypané přes `interaction`, `render` a `ui`; M14 by sahalo do pěti modulů. A `refPick` dnes zvýrazňuje plochy, i když parametr bere jen tělesa: chybí **filtr výběru** (Onshape *selection filter*, Fusion totéž).

**Návrh:**
- `ViewportPort.pick(x, y, filter: PickFilter)` (`'body' | 'face' | 'edge' | 'vertex' | 'sketchEntity'`), hover respektuje filtr.
- `PickResult { body, sub: SubShapeIndex, point, normal? }` místo dvou variant s různými názvy indexů.
- `RegenSnapshot` (nebo artefakt tělesa) nese `names: NameTable`; `SelectionItem` pro podtvar drží `TopoRef` + index platný pro aktuální generaci; při nové generaci se **přemapuje** podle jména, vymaže se jen to, co jméno ztratilo.

**Kdy:** filtr v [[M11-dalsi-entity|M11]] (výběr těles pro Boolean), tvar typů teď, jména v [[M14-topologicke-pojmenovani|M14]].

### 6. Režimy a sady nástrojů pro skicář chybí

**Kde:** `src/interaction/tool-manager.ts` (jeden aktivní nástroj + `refPick`), `src/interaction/tools.ts` (`ToolDescriptor.group: 'sketch'` existuje, nic ho nefiltruje), `src/interaction/actions.ts` (zkratky globální: `S` = potlačit).

**Proč to bude bolet:** skicování je **modální**: jiná lišta nástrojů (Fusion záložka *Sketch*, Onshape kontextová lišta), kamera kolmo na rovinu, 2D picking entit skici, tlačítko *Finish sketch*, jiné zkratky (`L` úsečka, `C` kružnice). Dnes není pojem režimu; `FeatureEditSession` je jediný modální stav a ten je o jednom dialogu.

**Návrh:** prezentační model `ModeModel` v `interaction` (`'model' | 'sketch'`), `ToolDescriptor.modes`, `Action.enabled` odvozené i z režimu (už je `Observable`), `Toolbar` kreslí nástroje aktivního režimu. Picking skici: buď `OverlayPort` dostane id a stane se pickovatelným, nebo skica je artefakt (viz 1), který render kreslí a pickuje sám (`PickResult` s `kind: 'sketchEntity'`). Druhé je konzistentnější.

**Kdy:** upřesnění [[12-skicar|spec 12]] před [[M12-skicar|M12]].

### 7. Schéma parametrů je ploché a bez podmínek; dojde mu dech u Extrude

**Kde:** `src/document/schema.ts` (`ParamSpec`), `src/document/validate.ts`, `src/ui/components/params/registry.ts` (`region` bez komponenty).

**Proč to bude bolet:** Extrude v Onshape i Fusion: operace (nové těleso / přidat / odebrat / průnik), typ konce (slepý / symetrický / po plochu / skrz vše), vzdálenost **jen u slepého**, otočení směru, druhá strana, úkos, rozsah sloučení. Potřebuje podmíněnou viditelnost, skupiny polí a jednotlivé reference. `ParamSpec` nemá `visibleWhen`, `group`, vnořené objekty ani sjednocení; validace by hlásila chybějící hodnotu u skrytého pole.

**Návrh:** `ParamSpec` doplnit o `visibleWhen?(params): boolean` (čistý predikát; `validateAgainstSchema` skryté parametry přeskočí, dialog je nekreslí), `group?: string`, jednotlivou referenci (`max: 1` s hodnotou `EntityRef | null`) a druhy `direction`, `axis`, `plane`. Zdokumentovaná úniková cesta: registr v `ui` `type → vlastní komponenta` pro featury, kterým generovaný formulář nestačí ([[11-ui]] to už připouští).

**Kdy:** [[M13-extrude-revolve|M13]]; `visibleWhen` ve validaci jde přidat kdykoli.

### 8. Cache podle identity předpokládá, že všechny vstupy featury jsou v `FeatureInstance`

**Kde:** [[0006-nemenna-data|ADR 0006]], `src/regen/regenerator.ts` (`features[k] === cache[k].feature`).

**Proč to bude bolet:** dnes to platí. S proměnnými dokumentu ([[Q003 Proměnné a výrazy v parametrech|Q003]]: `#delka * 2`), jednotkami dokumentu nebo odvozenými (derived) daty **změna proměnné nezmění identitu žádné featury**, `k` dojde na konec a nic se nepřepočítá. Tichá chyba.

**Návrh:** zapsat jako omezení do ADR 0006. Až proměnné přijdou: regenerace dostane `{ features, variables }`, a buď při změně identity `variables` zahodí cache celou, nebo (lépe) přes graf závislostí z bodu 3 najde první featuru, která proměnnou používá.

**Kdy:** při rozhodnutí Q003.

### 9. Profil přes hranici workeru (`ProfileInput`) není navržený

**Kde:** [[06-geometricke-jadro#Plánované rozšíření]] (`extrude(profile: ProfileInput, …)`), [[12-skicar#Profily]].

**Proč to bude bolet:** jsou dvě cesty a každá táhne jiný návrh. (a) Profil jako data (rovina + smyčky), jádro z nich postaví face až v `extrude`. (b) Builder skici vytvoří v jádře **wire/face s handle** a uloží je jako artefakt. Varianta (b) skládá: sweep po dráze, revolve kolem úsečky skici, loft mezi dvěma skicami, a tessellace křivek skici pro zobrazení přijde zadarmo přes `tessellateCurves(handle)`. Varianta (a) je jednodušší pro M13, ale M14 (jména bočních ploch podle entit skici) a budoucí sweep ji budou přepisovat.

**Návrh:** profil = handle(s) v jádře vytvořené builderem skici; jména oblastí zůstanou v TypeScriptu. Rozhodnout spolu s bodem 1.

**Kdy:** [[M12-skicar|M12]] / [[M13-extrude-revolve|M13]].

## Menší nálezy

- `AppViewport` v `src/app/session.ts` opisuje tvar `Viewport` z `render`; při změně portu se rozejdou. Exportovat jeden typ z `render` (`Viewport` bez `Disposable`).
- `FeaturePlugin` nemá `ops` a `plugin-api` nesmí na `ops`; M12 změní tabulku závislostí. Zapsat do plánu M12.
- Operace na úrovni dokumentu neexistují: `DocumentWriter.rename` nemá operaci (není v logu), proměnné, metadata těles a případná Part Studia ([[Q001 Jedno nebo více Part Studií|Q001]]) budou nové rodiny operací. Není to chyba, jen vědět, že `feature.*` není celý jazyk.
- Chybná featura propouští stav beze změny (jako Onshape). Po neúspěšném Booleanu tak navazující featury tiše staví nad oběma tělesy. Zvážit stav „odvozeno z chyby“ v Timeline.
- Kontrakt „přechodná operace komutuje s logovanými“ (`src/ops/transaction.ts`) nic neověřuje. Levná pojistka: test, který přehraje záznam bez přechodných kroků a porovná `toData`.
- Picking běží na CPU přes všechny hrany při každém pohybu myši; spec 09 to ví. GPU picking až podle měření v M15.
- Jedno sériové jádro: dlouhý fillet zablokuje i tessellaci pro náhled ([[Q010 Zrušení probíhající operace jádra|Q010]], [[Q011 Více workerů jádra|Q011]]). Zatím v pořádku.
- Pokud někdy víc Part Studií: každá operace bude potřebovat `studio`; `upcast` ho doplní výchozí hodnotou, log se nemusí přepisovat.

## Doporučené pořadí

1. **Před M11:** identita tělesa (2), `referencesOf` + graf závislostí + pravidla přesunu/mazání (3), filtr pickingu a tvar `PickResult` (5), rozhodnutí o migraci v logu (4).
2. **Před M12:** artefakty ve stavu regenerace a kanál do renderu (1), režimy (6), profil jako handle (9).
3. **Před M13:** rozšíření `ParamSpec` (7).
4. **Před M14:** jména v `RegenStatusPort` a přemapování výběru (5).
5. **S Q003:** omezení cache (8).

Srovnání s [[Jak Onshape modeluje s historií|Onshape]]: model receptu, lineární regenerace a červených featur máme stejný. Co Onshape navíc má a nám zatím chybí, je **bohatost odkazů** (dotazy nad všemi druhy entit, ne jen tělesa) a **druhy entit** v kontextu Part Studia. Body 1, 2, 3 a 5 jsou přesně tenhle rozdíl.
