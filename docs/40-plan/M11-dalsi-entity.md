---
type: milestone
status: done
order: 11
aliases:
  - M11
  - M11 Další entity
modules:
  - kernel
  - kernel-occt
  - document
  - ops
  - regen
  - interaction
  - features
  - app
  - ui
specs:
  - "[[03-dokument]]"
  - "[[04-operace-a-historie]]"
  - "[[06-geometricke-jadro]]"
  - "[[07-regenerace]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
depends_on:
  - "[[M10.1-zpevneni-kostry]]"
started: 2026-10-14
finished: 2026-10-14
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-14
---
# M11 – Další entity: Cylinder, Transform, Boolean

**Cíl:** ověřit rozšiřitelnost. Přidat tři nové featury **bez změny kódu mimo `src/features/*`** (a nových operací jádra). Kde to nejde, opravit architekturu a zapsat proč. Spolu s tím úkoly z revize architektury, jejichž první spotřebitel jsou reference na tělesa (identita u Transform/Boolean, závislosti při mazání a přesunu, metadata těles).

**Specifikace:** [[03-dokument|03]], [[04-operace-a-historie|04]], [[06-geometricke-jadro|06]], [[07-regenerace|07]], [[10-interakce|10]], [[11-ui|11]]

**Navazuje na:** [[M10.1-zpevneni-kostry]]

**Rozhodnutí** (noční rychloakce, bez Pavla): R3–R20 v [[Rozhodnutí noční rychloakce#M11 – Další entity]], otázky [[Q017 Průhlednost a skrývání těles|Q017]], [[Q071 Viditelnost těles|Q071]] (přehodnocena), nová [[Q073 Průhlednost a barva těles|Q073]] (odložena do M15).

## Co už existuje (z M9–M10.1, neplánuje se znovu)

- Druh parametru `bodies` ve schématu, `readRef`, validace referencí (`param.invalidRef`, `tooFewRefs`, `tooManyRefs`), `referencesOf`, `dependenciesOf`, `dependentsOf`, `orderViolations` ([[03-dokument#Id těles a závislosti]]).
- `RefListField` v registru polí (zatím jen počet a stav „aktivní“), `focusRefParam`, vnitřní nástroj `refPick` s filtrem pickingu, který klikem ve viewportu přidá/odebere `BodyRef` ([[10-interakce#Nástroje]]).
- `BuildContext.resolveBodies` vrací `RefError` pro neexistující těleso i jiný druh artefaktu ([[07-regenerace#Builder featury]]). Chybí jen jednotný převod na chybu featury – řeší Ú1.

## Úkoly

- [x] Ú1 `kernel`, `kernel-occt`, `regen`: `makeCylinder`, `TransformOps`, `BooleanOps` (Fake + OCCT), `ModelingKernel`, převod `RefError` → `UNRESOLVED_REFERENCE`
- [x] Ú2 `document`, `ops`: metadata těles v dokumentu, operace `body.rename` a `body.setVisible`, duplicitní reference
- [x] Ú3 `interaction`, `app`, `ui`: závislosti ve stromu featur (`dependents`, `move`), potvrzení mazání, překlady vlny A
- [x] Ú4 `features/cylinder`: plugin Cylinder
- [x] Ú5 `features/transform`: plugin Transform
- [x] Ú6 `features/boolean`: plugin Boolean
- [x] Ú7 `interaction`, `app`, `ui`: Prohlížeč nad metadaty (jméno, viditelnost), `RefListField` se seznamem těles, výběr těles z Prohlížeče do dialogu
- [x] Ú8 `app`, `tests`, `e2e`: registrace pluginů, scénář kvádr/válec/boolean
- [x] Ú9 hlavní sezení: kontrola, vault, `architecture-reviewer`, retrospektiva s měřítkem rozšiřitelnosti

## Akceptační kritéria

- Tři nové featury fungují v aplikaci (OCCT v prohlížeči) včetně undo a ukládání (e2e Ú8).
- Scénář: kvádr, válec, boolean rozdíl → jedno těleso s id kvádru; smazání válce se potvrdí dotazem „1 featura ztratí referenci“, boolean je pak červený (`UNRESOLVED_REFERENCE`, přeložená chyba), kvádr v pořádku, undo vrátí válec i zelený boolean.
- Transform i Boolean zachovají `BodyId` podle [[07-regenerace#Builder featury|pravidla identity]]; změna parametru válce nezmění id výsledku booleanu.
- Skrytí a přejmenování tělesa přežije reload, jde přes undo a přežije změnu historie (identita = rodokmen).
- Seznam souborů změněných mimo `features/*` je v retrospektivě, rozdělený na „kvůli novým entitám“ a „kvůli úkolům z revize“, každý se zdůvodněním.
- `npm run check`, `npm run build`, `npm run test:e2e` zelené.

## Úkoly z revize architektury (doplněno 2026-10-13, [[M10.1-zpevneni-kostry]])

Nálezy 2 a 3 z [[Revize architektury 2026-10-13]], jejichž první spotřebitel vzniká až tady. Zapracováno do Implementačního plánu (2026-10-14), u každého bodu je, kde se řeší.

- [x] **Pravidlo identity u Transform a Boolean** ([[07-regenerace]]): Transform zachová `id`, `origin`, `names`, nastaví `lastModifiedBy`; Boolean dědí `id` prvního cíle, nástroje z mapy odebere; `keepTools` je zachová beze změny; více výsledných solidů → `bodyId(cíl.origin, n)` podle rodokmenu z historie jádra (`Generated`/`Modified`), ne podle pořadí výstupu. Test: změna parametru válce nepřehodí id dvou výsledných těles. → Ú5, Ú6. **Zúženo (R8 ⚠):** výsledek booleanu je v M11 vždy jedno těleso (jeden handle, případně compound více solidů); rozpad na více těles podle historie jádra je úkol [[M14-topologicke-pojmenovani|M14]], kde historie jádra vzniká. Test se mění na „změna parametru válce nezmění id výsledku“.
- [x] **Pravidla závislostí v `interaction`** ([[10-interakce]]): `FeatureTreeModel.move(id, toIndex)` (nový příkaz pro budoucí tažení v Timeline) odmítne přesun, po kterém `orderViolations` není prázdné; akce `feature.delete` nejdřív spočítá `dependentsOf` a UI zobrazí potvrzení „N featur ztratí referenci“ (jako Fusion); řádek Timeline nese `dependents: number` pro tooltip. Testy v Node s `dependenciesOf` z `document`. → Ú3 (`move` bez UI tažení, R17 ⚠).
- [x] **Metadata těles v dokumentu** ([[03-dokument]], [[04-operace-a-historie]]): `PartStudioData.bodies?: Readonly<Record<BodyId, { name?: string; hidden?: boolean }>>` a operace `body.rename`, `body.setVisible` s inverzí; Prohlížeč jméno zobrazí a viditelnost ukládá sem místo stavu pohledu (přehodnotit [[Q071 Viditelnost těles|Q071]]: identita je od M10.1 rodokmen, takže už se nepřenese na jiné těleso). Barva až s [[Q017 Průhlednost a skrývání těles|Q017]]. → Ú2, Ú7; barva a průhlednost [[Q073 Průhlednost a barva těles|Q073]].
- [x] **Měřítko rozšiřitelnosti:** do retrospektivy zapsat seznam souborů mimo `features/*` změněných kvůli novým entitám, odděleně od souborů změněných kvůli úkolům výše. → Ú9.

## Implementační plán

Každý úkol dělá zvlášť subagent `implementer` (TDD: test nejdřív a ověřit, že padá; `npm run check`). Kontrakty níže jsou propsané do specifikací (odkazy u úkolů); implementátor hlásí odchylky, hlavní sezení je propíše. Seznam souborů je vodítko: sáhnout jinam smí, když to dává smysl, a ohlásí to.

**Paralelní běh:** úkoly jedné vlny mají oddělené soubory a běží souběžně ve vlastních worktree. `index.ts` modulu, `src/ui/i18n/{cs,en}.ts`, `src/app/session.ts` a `src/app/plugins.ts` smí v dané vlně měnit jen úkol, u kterého jsou uvedené.

| Vlna | Úkoly (paralelně) | Závisí na |
|---|---|---|
| A | Ú1 operace jádra (`kernel`, `kernel-occt`, `regen`) · Ú2 metadata těles (`document`, `ops`) · Ú3 závislosti a potvrzení mazání (`interaction`, `app`, `ui`) | – |
| B | Ú4 Cylinder · Ú5 Transform · Ú6 Boolean (každý jen `features/<typ>`) · Ú7 Prohlížeč a `RefListField` (`interaction`, `app`, `ui`) | Ú4–Ú6 na Ú1 (a Ú6 na Ú2 kvůli `param.duplicateRef`); Ú7 na Ú2 a Ú3 |
| C | Ú8 registrace a scénář (`app/plugins.ts`, `tests/`, `e2e/`) | B |
| D | Ú9 hlavní sezení | C |

Proč jádro jako jeden úkol: port (`GeometryKernel`) je sdílený typ, ze kterého se odvozuje protokol workeru (`OcctKernelProtocol`) i sledované jádro v `regen`. Rozšíření portu bez obou implementací by neprošlo `typecheck`, takže rozdělení by vynutilo dočasné stuby.

### Vlna A

#### Ú1 `kernel`, `kernel-occt`, `regen`: operace jádra pro M11
- **Soubory:** `src/kernel/kernel.ts`, `src/kernel/transform.ts` (nový: `isRigidMotion`), `src/kernel/index.ts`, `src/kernel/fake-kernel.ts`, `src/kernel/testing.ts` (kontraktová sada), testy `fake-kernel.test.ts`, `transform.test.ts`, `index.test.ts`; `src/kernel-occt/occt-kernel-impl.ts`, `client.ts`, `worker-impl.ts`, testy `occt-kernel-impl.test.ts`, `client.test.ts`, `worker-impl.test.ts` (nový test OCCT-specifických očekávání smí být nový soubor `occt-modeling.test.ts`); `src/regen/builder.ts` (`ModelingKernel`, `unresolvedReference`), `src/regen/tracking-kernel.ts`, `src/regen/index.ts`, testy `tracking-kernel.test.ts`, `builder.test.ts`, `index.test.ts`.
- **Kontrakt** ([[06-geometricke-jadro#Stav po M11]], [[06-geometricke-jadro#`FakeKernel`]], [[07-regenerace#Builder featury]]):
  ```ts
  // kernel/kernel.ts
  export interface PrimitiveOps {
    makeBox(p: { readonly origin: Vec3; readonly size: Vec3 }): Promise<ShapeResult>;
    /** Válec: podstava se středem base, osa ve směru axis (nemusí být jednotková), výška height podél osy. */
    makeCylinder(p: { readonly base: Vec3; readonly axis: Vec3; readonly radius: number; readonly height: number }): Promise<ShapeResult>;
  }
  export interface TransformOps {
    /** Nový tvar = shape přemístěný tuhou transformací m (rotace + posun, bez zrcadlení a měřítka). */
    transform(shape: ShapeHandle, m: Mat4): Promise<ShapeResult>;
  }
  export type BooleanOp = 'union' | 'subtract' | 'intersect';
  export interface BooleanOps {
    /** Jeden výsledný tvar (případně compound více solidů); vstupy zůstávají platné. */
    boolean(op: BooleanOp, targets: readonly ShapeHandle[], tools: readonly ShapeHandle[]): Promise<ShapeResult>;
  }
  export interface GeometryKernel extends PrimitiveOps, TransformOps, BooleanOps, MeshOps, QueryOps, LifecycleOps {}

  // kernel/transform.ts (export z index.ts; používají obě implementace)
  /** m je tuhý pohyb: konečná čísla, spodní řádek [0,0,0,1], rotační část ortonormální s det +1 (tolerance po prvcích). */
  export function isRigidMotion(m: Mat4, tolerance?: number): boolean;   // výchozí tolerance 1e-9

  // regen/builder.ts
  export type ModelingKernel = PrimitiveOps & TransformOps & BooleanOps & QueryOps;
  /** Chyba featury pro nevyřešenou referenci parametru param (Q044); hluboce zmrazená. */
  export function unresolvedReference(param: string, e: RefError): FeatureError;
  // → { code: 'UNRESOLVED_REFERENCE', message: e.message, issues: [{ param, code: 'param.unresolvedRef' }] }
  ```
  - **Validace (obě jádra, chyba `'invalid-input'`):** `makeCylinder` – každá složka `base` a `axis` konečná, délka `axis` > 1e-9, `radius` a `height` konečné > 0. `transform` – všech 16 prvků konečných a `isRigidMotion(m)`; neznámý handle → `'unknown-handle'`. `boolean` – `op` je jedna ze tří hodnot, `targets` i `tools` neprázdné, žádný handle se neopakuje (ani napříč seznamy); neznámý handle → `'unknown-handle'`. Pořadí kontrol při více chybách není určeno (jako dosud).
  - **Výsledek:** každé volání vrací nový handle (+1 živý), vstupní handle zůstávají platné a nezměněné; `history` a `roles` se nevyplňují (M14). Výsledek booleanu bez jediného solidu (prázdný průnik, rozdíl, který cíl celý odebere) → `'operation-failed'`; selhání algoritmu OCCT (`HasErrors()`) → `'operation-failed'`.
  - **Izolace:** vstupy (`base`, `axis`, `m`, pole handle) se čtou synchronně při volání (jako u `makeBox`).
  - **FakeKernel (AABB):** válec = AABB válce pro libovolnou osu (`a` = jednotková osa, rozšíření ve složce `k` je `radius · sqrt(1 − a_k²)` kolem podstavy i horní podstavy `base + height·a`); `transform` = AABB osmi rohů vstupního AABB po `mat4.transformPoint`; `union` = obalový AABB všech vstupů; `subtract` = obalový AABB cílů (jeden cíl → beze změny); `intersect` = průnik obalu cílů s obalem nástrojů, prázdný nebo nulové tloušťky v kterékoli ose → `'operation-failed'`. `tessellate` čehokoli dál vrací kvádr podle AABB (beze změny). Záznam se přejmenuje na `AabbEntry`.
  - **OCCT:** válec `BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(base), gp_Dir(axis)), radius, height)`; transform `gp_Trsf.SetValues(a11…a34)` (řádkově; `a_rc = m[c*4 + r]`, `Mat4` je po sloupcích) a `BRepBuilderAPI_Transform(shape, trsf, false)` (tuhý pohyb jen nastaví lokaci, geometrie se nekopíruje); boolean prázdným konstruktorem `BRepAlgoAPI_Fuse|Cut|Common`, `SetArguments(targets)`, `SetTools(tools)` (seznamy `NCollection_List_TopoDS_Shape`; `Append` vrací nový obal `TopoDS_Shape`, který je potřeba smazat), `Build()`, `HasErrors()`, kontrola solidu přes `TopExp_Explorer(result, TopAbs_SOLID).More()`. Všechny objekty OCCT přes `using`. Tessellace lokaci ploch už aplikuje; zrcadlící lokace nevznikne, protože `transform` přijímá jen tuhé pohyby (poznámka v spec 06 se uzavře).
  - `client.ts` a `worker-impl.ts` přeposílají tři nové metody stejně jako `makeBox` (protokol se odvozuje z portu sám).
  - `tracking-kernel.ts`: `makeCylinder`, `transform`, `boolean` vracejí `ShapeResult` přes `track` (vlastněná množina).
- **Testy:**
  - **Kontraktová sada** (`describeGeometryKernelContract`, platí pro Fake i OCCT; bbox porovnávat s tolerancí 1e-5 v každé složce, ne přesně): `makeCylinder` pro osy `[1,0,0]`, `[0,1,0]`, `[0,0,2]` (nejednotková) dá bbox válce; každý neplatný vstup → `'invalid-input'` bez handle; síť výsledku projde `validateMeshData` a body leží v bbox (s tolerancí sítě). `transform`: posun kvádru posune bbox; rotace o 90° kolem Z kolem počátku; rotace o 45° kolem Z dá bbox otočených rohů; vstup zůstane platný a se stejným bbox; neortonormální matice, zrcadlení (`det −1`), měřítko 2 a matice s `NaN` → `'invalid-input'`; neznámý handle → `'unknown-handle'`. `boolean`: `union` dvou překrývajících se i dvou oddělených kvádrů → obalový bbox; `intersect` překrývajících se → přesný průnik, oddělených → `'operation-failed'` bez nového handle; `subtract` kvádru a kvádru, který mu odřízne roh (ne celou stěnu) → bbox cíle; prázdné `targets`/`tools`, opakovaný handle, neznámé `op` → `'invalid-input'`; vstupy zůstanou platné; síť každého výsledku projde `validateMeshData`; izolace (změna pole handle a matice hned po volání nic nezmění).
  - `isRigidMotion`: identita, rotace kolem libovolné osy s posunem → `true`; zrcadlení, měřítko, zkosení, neafinní spodní řádek, `NaN` → `false`.
  - **Fake navíc:** AABB šikmého válce (osa `[1,1,0]`); `subtract` s nástrojem, který cíl celý pokryje, vrátí bbox cíle (Fake nic neodečítá); `failNext('boolean', …)` funguje pro nové metody; `callCount('makeCylinder')`.
  - **OCCT navíc** (`kernel-occt`, mimo kontrakt): válec má v síti právě 3 plochy (`faceRanges`) a objem ze sítě (věta o divergenci nad trojúhelníky, `linearDeflection` 0.01) do 1 % od `πr²h`; posunutý a otočený kvádr má dál 6 ploch a stejný objem; `subtract` kvádru a válce, který jím prochází, má 7 ploch a objem `kvádr − πr²h` do 1 %; `subtract`, kde nástroj cíl celý pokryje → `'operation-failed'`; `union` dvou oddělených kvádrů → 12 ploch.
  - `regen`: `createTrackingKernel` zapíše handle z `makeCylinder`, `transform`, `boolean` do vlastněné množiny, chyby jádra propustí beze změny; `unresolvedReference('tools', e)` → kód, zpráva z `e`, `issues` s `param.unresolvedRef`, zmrazené do hloubky; `index.ts` exportuje `unresolvedReference`.
- **Hotovo když:** testy a `npm run check` projdou; `kernel` exportuje `TransformOps`, `BooleanOps`, `BooleanOp`, `isRigidMotion`.

#### Ú2 `document`, `ops`: metadata těles a duplicitní reference
- **Soubory:** `src/document/model.ts`, `document.ts`, `cad-document.ts`, `serialize.ts`, `refs.ts` (`parseBodyId`), `validate.ts`, `index.ts`, `testing.ts` (jen je-li potřeba) + testy `cad-document.test.ts`, `serialize.test.ts`, `refs.test.ts`, `validate.test.ts`, `index.test.ts`; `src/ops/operation.ts`, `src/ops/handlers/body.ts` (nový), `src/ops/handler.ts` (registrace), `src/ops/handlers/shape.ts` (kontrola id tělesa), `src/ops/index.ts` + testy `handlers.test.ts`, `validate.test.ts`, `replay.property.test.ts`, `index.test.ts`; `src/persistence/load.test.ts` (jeden test uložení a načtení metadat).
- **Kontrakt** ([[03-dokument#Metadata těles]], [[04-operace-a-historie#Sada operací]]):
  ```ts
  // document/model.ts
  export interface BodyMeta { readonly name?: string; readonly hidden?: true }
  export interface PartStudioData {
    readonly features: readonly FeatureInstance[];
    readonly rollbackIndex: number;
    /** Metadata těles podle rodokmenu (ADR 0015); kanonický tvar: chybí, když je prázdné. */
    readonly bodies?: Readonly<Record<BodyId, BodyMeta>>;
  }
  // document/document.ts
  DocumentReader.bodyMeta(body: BodyId): BodyMeta;          // {} (sdílený zmrazený) pro těleso bez metadat
  DocumentWriter.setBodyMeta(body: BodyId, meta: BodyMeta): void;
  // document/refs.ts (export z index.ts)
  /** Text ve tvaru id tělesa '<vlastník>/body[:<n>]' → BodyId, jinak undefined. Důvěryhodné místo přetypování. */
  export function parseBodyId(v: unknown): BodyId | undefined;

  // ops/operation.ts
  OP_VERSION['body.rename'] = 1; OP_VERSION['body.setVisible'] = 1;
  export interface BodyRenameOp extends Operation { readonly type: 'body.rename'; readonly body: BodyId; readonly name: string }   // '' = smazat jméno
  export interface BodySetVisibleOp extends Operation { readonly type: 'body.setVisible'; readonly body: BodyId; readonly visible: boolean }
  ```
  - **Kanonický tvar** (kvůli determinismu a porovnání `toData`): `setBodyMeta` uloží jen `name` neprázdné a `hidden` jen jako `true`; prázdné metadata záznam odeberou; prázdná mapa → vlastnost `bodies` ve studiu chybí. Stejná metadata (po hodnotě) → nic se nezmění, `changed` se nevyšle. Změna metadat vytvoří nové `studio` se **stejným** polem `features` a stejným `rollbackIndex` (cache regenerace podle identity featur zůstane platná). Všechny ostatní mutátory `bodies` zachovají. Metadata se ke tělesu neváží existencí: dokument tělesa nezná, záznam smazané featury zůstane (undo smazání ho tak vrátí i se jménem).
  - `fromData`: `studio.bodies` chybí → bez metadat; jinak objekt, klíče přes `parseBodyId` (jinak issue `studio.bodies['<klíč>']`), hodnota objekt jen s `name` (neprázdný řetězec) a `hidden` (boolean; `false` se při načtení vypustí); jiný klíč v hodnotě → issue (přísnost jako u parametrů, [[Q028 Chybějící a přebytečné parametry|Q028]]). Výsledek v kanonickém tvaru, zmrazený. `toData` beze změny (data už jsou JSON).
  - **Handlery** (`ops/handlers/body.ts`): `body.rename` – `invert` → `body.rename` s aktuálním `name ?? ''`; `apply` → `setBodyMeta(body, { ...aktuální, name })` (kanonizace v dokumentu); `validate` – `body` přes `parseBodyId` (cesta `body`), `name` řetězec. `body.setVisible` – `invert` → s aktuálním `!hidden`; `apply` → `hidden: visible ? undefined : true`; `validate` – `body`, `visible` boolean. Bez `merge`, bez `upcast`. Neexistující těleso není chyba (dokument tělesa nezná). Rollback bar se nemění, takže `applyOperation` je neobaluje.
  - **Duplicitní reference** ([[03-dokument#Schéma featury]]): `validateAgainstSchema` u druhů `bodies`, `topo`, `region` po kontrole tvaru hlásí první položku, která se shoduje s dřívější (`body` u body, `body`+`name` u topo, `sketch`+`region` u region): `{ param, code: 'param.duplicateRef', params: { index } }`. Pořadí kontrol: `invalidRef`, `duplicateRef`, `tooFewRefs`, `tooManyRefs`.
- **Testy:**
  - `document`: `setBodyMeta` uloží jméno a skrytí, kanonizuje (`hidden` bez `true`, prázdné jméno, prázdná metadata, prázdná mapa → bez `bodies`); stejná metadata nevyšlou `changed`; `features` zůstane totéž pole; `insertFeature`, `removeFeature`, `moveFeature`, `setRollbackIndex`, `replaceFeature` metadata zachovají; data jsou zmrazená; `bodyMeta` neznámého tělesa → `{}`; `fromData` – bez `bodies`, platné, neplatný klíč, neplatná hodnota, cizí klíč v hodnotě, `hidden: false` vypuštěno; `parseBodyId` pro platné a neplatné tvary; `validateAgainstSchema` – duplicita v `bodies` (index druhé položky), v `topo` (stejné těleso i jméno), různá jména na jednom tělese nejsou duplicita; `index.ts` exportuje `parseBodyId` a typ `BodyMeta`.
  - `ops`: oba handlery – `invert` → `apply(op)` → `apply(inverze)` = původní `toData`; `invert` na těleso bez metadat; `validate` s rozbitým `body`, `name`, `visible` (cesty); `upcastOperation` aktuální verze; replay property test rozšířit o kroky `body.rename` a `body.setVisible` (náhodné těleso z malé množiny) – replay = živý dokument; undo/redo vrací metadata.
  - `persistence`: dokument se skrytým a přejmenovaným tělesem po uložení a `loadDocument` (snapshot i přehrání logu, `verify: true`) má stejná metadata.
- **Hotovo když:** testy a `npm run check` projdou.

#### Ú3 `interaction`, `app`, `ui`: závislosti ve stromu featur a potvrzení mazání
- **Soubory:** `src/interaction/feature-tree.ts`, `builtin-actions.ts`, `index.ts` + testy `feature-tree.test.ts`, `builtin-actions.test.ts`, `index.test.ts`; `src/app/session.ts`, `src/app/browser.ts`, `src/app/testing.ts` (jen je-li potřeba) + testy `session.test.ts`, `dispose-open-session.test.ts`, `plugins.test.ts` (doplnit `confirm` do deps); `src/ui/App.vue`, `src/ui/components/TimelineItem.vue`, `src/ui/i18n/cs.ts`, `en.ts`.
- **Kontrakt** ([[10-interakce#Strom featur: `FeatureTreeModel`]], [[10-interakce#Vestavěné akce]], [[11-ui#Kompoziční kořen (app)]]):
  ```ts
  // interaction/feature-tree.ts
  TreeRow.dependents: number;                       // počet featur, které na řádkové featuře závisí (dependentsOf), pro tooltip
  FeatureTreeModel.dependentsOf(ids: readonly FeatureId[]): readonly FeatureId[];
  //   featury mimo ids, které závisí na kterékoli z ids, v pořadí studia, bez duplicit
  FeatureTreeModel.move(id: FeatureId, toIndex: number): readonly OrderViolation[];
  //   prázdné = přesunuto (dispatch feature.move; stejný index → nic) ; neprázdné = odmítnuto, nic se nestalo

  // interaction/builtin-actions.ts
  export interface ConfirmRequest { readonly key: string; readonly params: Readonly<Record<string, string | number>> }
  createBuiltInActions(deps: { …; confirm: (request: ConfirmRequest) => boolean })

  // app
  AppSessionDeps.confirm: (request: ConfirmRequest) => boolean;     // povinné
  OpenAppSessionOptions.confirm: (request: ConfirmRequest) => boolean;
  ```
  - Strom počítá závislosti `dependenciesOf(doc.studio, schemas)` jednou při každém přepočtu (změna dokumentu); `dependents` je součást porovnání nezměněného řádku.
  - `move`: id neznámé nebo `toIndex` mimo `0..features.length − 1` → výjimka. Odmítne přesun, po kterém vznikne **nové** porušení pořadí (dvojice z `orderViolations`, která v aktuálním stavu není); vrátí právě nová porušení. Porušení, která už v dokumentu jsou (data zvenku), přesun neblokují. Během transakce výjimka z dispečera jako u `rename`. UI tažení v Timeline v M11 nevzniká (R17).
  - `feature.delete`: spočítá `featureTree.dependentsOf(odstraňované)`; je-li jich `n > 0`, zavolá `confirm({ key: 'feature.delete.confirm', params: { n } })` a při `false` nic nesmaže (výběr se nemění). Při `n === 0` se neptá.
  - `app`: `confirm` předá do `createBuiltInActions`; `openAppSession` ho předá z voleb. `ui` (`App.vue`) dodá `({ key, params }) => globalThis.confirm(i18n.global.t(key, params))` – stejně jako mazání dokumentu v `DocumentList` (R16).
  - `TimelineItem`: v tooltipu a přístupném popisu `t('timeline.dependents', { n })`, když `dependents > 0`.
  - **Překlady vlny A** (cs / en) – všechny klíče, které vlna A potřebuje, přidává jen tento úkol:
    - `param.duplicateRef`: „Položka {index} je ve výběru dvakrát“ / “Item {index} is selected twice”
    - `param.unresolvedRef`: „Odkazované těleso neexistuje“ / “The referenced body does not exist”
    - `feature.delete.confirm`: „Počet featur, které ztratí referenci: {n}. Přesto smazat?“ / “Features that will lose a reference: {n}. Delete anyway?”
    - `timeline.dependents`: „Závisí na ní: {n}“ / “Used by: {n}”
- **Testy:** `dependents` u kvádru, na který odkazuje jedna featura (testovací schéma s parametrem `bodies` v testu, ne skutečný Boolean); řádek bez závislostí 0; změna reference změní `dependents` a jen dotčené řádky; `dependentsOf` pro více id (vynechá id samotná, bez duplicit); `move` – platný přesun dispatchne `feature.move`, přesun závislé featury před závislost vrátí porušení a nic nezmění (log beze změny), stejný index nic, mimo rozsah výjimka, existující porušení neblokuje jiný přesun; `feature.delete` bez závislých se neptá, se závislými se zeptá s `n`, `false` nic nesmaže, `true` smaže jako dosud; `app`: session předá `confirm` (akce smazání v testu session s falešným `confirm`).
- **Hotovo když:** testy a `npm run check` projdou; e2e M10 beze změny.

### Vlna B

Pluginy Ú4–Ú6 mají strukturu jako `features/box` (`index.ts`, `schema.ts`, `builder.ts`, `messages.ts`, `tool.ts`, `<typ>.test.ts`) a testy ve stylu `box.test.ts`: veřejné API (`<typ>Plugin`), schéma (verze 1, klíče překladu, hluboké zmrazení, výchozí hodnoty projdou validací, `defaults()` nový objekt, chyby parametrů), `messages` (cs i en pro každý klíč schématu a vlastní kód chyby, stejné klíče, zmrazené), builder s `FakeKernel` přes `aBuildContext`, plugin v `Regenerator`, nástroj s `ToolManager` (otevře dialog a skončí). Do `app/plugins.ts` je **nezapisují** (Ú8). Mimo vlastní složku nemění nic; potřeba změny mimo ni = otázka pro hlavní sezení (to je měřítko M11).

#### Ú4 `features/cylinder`: plugin Cylinder
- **Soubory:** `src/features/cylinder/*` (nová složka).
- **Kontrakt** ([[07-regenerace#Builder featury]], [[06-geometricke-jadro#Stav po M11]]):
  ```ts
  export interface CylinderParams {
    readonly base: Vec3;                    // střed podstavy, výchozí [0, 0, 0]
    readonly axis: 'x' | 'y' | 'z';         // osa válce (enum, R5), výchozí 'z'
    readonly radius: number;                // length > 0 (exclusiveMin), výchozí 5
    readonly height: number;                // length > 0 (exclusiveMin), výchozí 10
  }
  export const cylinderPlugin: FeaturePlugin<CylinderParams>;
  ```
  - Schéma `type: 'cylinder'`, `version: 1`, `label: 'cylinder.label'`, `icon: 'cylinder'`; parametry v pořadí `base` (point), `axis` (enum s volbami `x`, `y`, `z`, popisky `cylinder.axis.x|y|z`), `radius`, `height`; `validate` = `validateAgainstSchema`.
  - Builder: `kernel.makeCylinder({ base, axis: AXIS[axis], radius, height })` s `AXIS = { x: [1,0,0], y: [0,1,0], z: [0,0,1] }`; těleso `bodyId(feature.id)`, `origin` i `lastModifiedBy` = `feature.id`, `kind: 'body'`, `names: EMPTY_NAMES`, zmrazené; nový stav jako u kvádru.
  - Nástroj `id: 'cylinder'`, `label: 'cylinder.label'`, `icon: 'cylinder'`, `group: 'primitive'`, `shortcut: 'C'`.
  - Texty: cs „Válec“, „Střed podstavy“, „Osa“, „X“, „Y“, „Z“, „Poloměr“, „Výška“; en “Cylinder”, “Base center”, “Axis”, “X”, “Y”, “Z”, “Radius”, “Height”.
- **Testy:** společné (viz výše); builder volá `makeCylinder` s osou podle enum (bbox z Fake pro každou osu); nulový/záporný poloměr a výška → `param.atOrBelowMin`; neznámá osa → `param.unknownOption`.
- **Hotovo když:** testy a `npm run check` projdou; mimo `features/cylinder` žádná změna.

#### Ú5 `features/transform`: plugin Transform
- **Soubory:** `src/features/transform/*` (nová složka).
- **Kontrakt** ([[07-regenerace#Builder featury]], pravidlo identity):
  ```ts
  export interface TransformParams {
    readonly bodies: readonly BodyRef[];    // bodies, min 1
    readonly translate: Vec3;               // point, výchozí [0, 0, 0]
    readonly axis: 'x' | 'y' | 'z';         // osa rotace přes počátek, výchozí 'z'
    readonly angle: number;                 // angle v radiánech (UI ve stupních), výchozí 0, bez mezí
  }
  export const transformPlugin: FeaturePlugin<TransformParams>;
  ```
  - Schéma `type: 'transform'`, `version: 1`, `label: 'transform.label'`, `icon: 'arrows-move'`; parametry v pořadí `bodies`, `translate`, `axis`, `angle`.
  - Builder: `ctx.resolveBodies(bodies)`; chyba → `{ ok: false, error: unresolvedReference('bodies', e) }`. Matice `m = mat4.multiply(mat4.translation(translate), mat4.rotationAxisAngle(AXIS[axis], angle))` – nejdřív rotace kolem osy přes **počátek světa**, pak posun (R6). Pro každé těleso v pořadí parametru `kernel.transform(body.shape, m)`, nové těleso `{ ...body, shape, lastModifiedBy: feature.id }` (zachová `id`, `origin`, `names`, pozici v mapě), zmrazené. Ostatní artefakty beze změny.
  - Nástroj `id: 'transform'`, `label: 'transform.label'`, `icon: 'arrows-move'`, `group: 'modify'`, bez zkratky.
  - Texty: cs „Transformace“, „Tělesa“, „Posun“, „Osa rotace“, „X“, „Y“, „Z“, „Úhel“; en “Transform”, “Bodies”, “Translation”, “Rotation axis”, “X”, “Y”, “Z”, “Angle”.
- **Testy:** společné; posun kvádru posune bbox a zachová `id`, `origin`, `names`, nastaví `lastModifiedBy`; rotace o 90° kolem Z (bbox z Fake); pořadí rotace a posunu (rotace 90° + posun [10,0,0] dá bbox podle `T·R`, ne `R·T`); dvě tělesa najednou, obě si nechají id; nevyřešená reference → `UNRESOLVED_REFERENCE` s `issues` `[{ param: 'bodies', code: 'param.unresolvedRef' }]` a stav se nepoužije; prázdný seznam → `param.tooFewRefs` (validace); v `Regenerator`: kvádr + transform → jedno těleso `b1/body` s `lastModifiedBy` transformu; změna parametru kvádru nezmění id.
- **Hotovo když:** testy a `npm run check` projdou; mimo `features/transform` žádná změna.

#### Ú6 `features/boolean`: plugin Boolean
- **Soubory:** `src/features/boolean/*` (nová složka).
- **Kontrakt** ([[07-regenerace#Builder featury]], pravidlo identity, R8, R9):
  ```ts
  export interface BooleanParams {
    readonly op: 'union' | 'subtract' | 'intersect';   // enum, výchozí 'union'
    readonly targets: readonly BodyRef[];               // bodies, min 1
    readonly tools: readonly BodyRef[];                 // bodies, min 1
    readonly keepTools: boolean;                        // výchozí false
  }
  export const booleanPlugin: FeaturePlugin<BooleanParams>;
  ```
  - Schéma `type: 'boolean'`, `version: 1`, `label: 'boolean.label'`, `icon: 'layers-union'`; parametry v pořadí `op` (volby `boolean.op.union|subtract|intersect`), `targets`, `tools`, `keepTools`. `validate` = `validateAgainstSchema` + vlastní pravidlo: těleso, které je v `targets` i v `tools` → `{ param: 'tools', code: 'boolean.sameBody', params: { index } }` (index položky v `tools`), jen když obě pole prošla kontrolou tvaru.
  - Builder: `resolveBodies(targets)` → chyba `unresolvedReference('targets', e)`; `resolveBodies(tools)` → `unresolvedReference('tools', e)`. Volání jádra: `union` → `kernel.boolean('union', [t0], [...ostatní cíle, ...nástroje])`; `subtract` → `('subtract', cíle, nástroje)`; `intersect` → `('intersect', cíle, nástroje)`. Výsledek: jedno těleso `{ ...t0, shape, lastModifiedBy: feature.id }` (dědí `id`, `origin`, `names` prvního cíle a jeho pozici v mapě); ostatní cíle z mapy odebere; nástroje odebere, s `keepTools` je nechá beze změny (tentýž objekt). Chyba jádra (`'operation-failed'` – prázdný výsledek) proletí a `Regenerator` z ní udělá `KERNEL`.
  - Nástroj `id: 'boolean'`, `label: 'boolean.label'`, `icon: 'layers-union'`, `group: 'modify'`, bez zkratky.
  - Texty: cs „Boolean“, „Operace“, „Sjednocení“, „Rozdíl“, „Průnik“, „Cíle“, „Nástroje“, „Ponechat nástroje“, `boolean.sameBody` „Těleso {index} je zároveň cílem“; en “Boolean”, “Operation”, “Union”, “Subtract”, “Intersect”, “Targets”, “Tools”, “Keep tools”, “Body {index} is also a target”.
- **Testy:** společné; každá operace volá jádro se správnými seznamy (`callCount` a bbox z Fake); výsledek má id, `origin` a `names` prvního cíle a `lastModifiedBy` booleanu; druhý cíl a nástroje zmizí, s `keepTools` nástroj zůstane tentýž objekt; pořadí mapy (výsledek na místě prvního cíle); `intersect` oddělených kvádrů → chyba `KERNEL` v `Regenerator` a stav propuštěn; nevyřešený cíl i nástroj → `UNRESOLVED_REFERENCE` se správným `param`; `boolean.sameBody`; duplicita v jednom seznamu → `param.duplicateRef` (z Ú2); v `Regenerator` se dvěma kvádry (plugin se nesmí importovat z jiné složky `features/*`, proto ne válec): subtract → jedno těleso s id prvního kvádru; změna parametru nástroje nezmění id výsledku; smazání nástroje → `UNRESOLVED_REFERENCE`, první kvádr v pořádku.
- **Hotovo když:** testy a `npm run check` projdou; mimo `features/boolean` žádná změna.

#### Ú7 `interaction`, `app`, `ui`: Prohlížeč nad metadaty, `RefListField`, výběr z Prohlížeče
- **Soubory:** `src/interaction/browser-model.ts`, `ref-values.ts` (nový: `toggleBodyRef`, přesun z `ref-pick-tool.ts`), `ref-pick-tool.ts`, `feature-editor.ts`, `index.ts` + testy `browser-model.test.ts`, `ref-pick-tool.test.ts`, `feature-editor.test.ts`; `src/app/session.ts` (deps `createBrowserModel`), `session.test.ts`; `src/ui/components/Browser.vue`, `src/ui/components/params/RefListField.vue`, `src/ui/i18n/cs.ts`, `en.ts`; `tests/feature-dialog.test.ts` jen je-li potřeba.
- **Kontrakt** ([[10-interakce#Prohlížeč: `BrowserModel` a viditelnost těles]], [[10-interakce#Dialog featury: `FeatureEditor`]], [[11-ui#Komponenty]]):
  ```ts
  export interface BrowserBodyRow {
    readonly body: BodyId;
    readonly name: { readonly key: 'browser.body'; readonly n: number };   // automatické jméno podle pořadí
    readonly userName: string | null;                                       // z metadat (body.rename), ui ho má přednostně
    readonly feature: FeatureId;
    readonly visible: boolean;                                              // !doc.bodyMeta(body).hidden
    readonly selected: boolean;
  }
  export interface BrowserModel {
    readonly bodies: Observable<readonly BrowserBodyRow[]>;
    readonly hidden: Observable<ReadonlySet<BodyId>>;     // tělesa poslední regenerace se skrytím v metadatech
    select(body: BodyId, opts?: { additive?: boolean }): void;
    setVisible(body: BodyId, visible: boolean): void;      // → dispatch body.setVisible
    rename(body: BodyId, name: string): void;              // → dispatch body.rename (oříznuté; stejné → nic; '' smaže jméno)
    /** Jméno tělesa pro čip v poli reference, jen z dokumentu: userName, jinak jméno featury původu
     *  (originOfBody), u id s číslem n přípona ' (n)'; featura původu v dokumentu není → null. */
    refLabel(body: BodyId): string | null;
    dispose(): void;
  }
  export function createBrowserModel(deps: {
    doc: DocumentReader; ops: OperationDispatcher; regen: RegenStatusPort;
    selection: SelectionCommands; editor: FeatureEditor;
  }): BrowserModel;
  // interaction/ref-values.ts (interní)
  export function toggleBodyRef(value: unknown, body: BodyId): readonly unknown[];   // dosavadní toggleBody z refPick
  ```
  - Model se přepočítá při změně regenerace, výběru i dokumentu (`doc.events.changed`). Viditelnost a jméno čte z `doc.bodyMeta`; stav pohledu (vlastní množina skrytých) zaniká.
  - `setVisible` a `rename` tělesa, které poslední regenerace nezná, nic neudělají; během transakce (`ops.inTransaction`) také nic (dialog je otevřený; UI tlačítka zakáže podle `session.locked`, R14). Shodná hodnota (viditelnost už je taková, jméno stejné po oříznutí) → nic. V režimu jen pro čtení dispečer odmítne – UI je zakáže podle `locked`.
  - `select(body)`: je-li otevřená session s `activeRefParam` druhu `bodies`, přidá/odebere těleso v tomto parametru (`session.setParam(name, toggleBodyRef(...))`) a výběr nemění; jinak výběr jako dosud (R19).
  - `FeatureEditor.create`: nová session má `activeRefParam` = první parametr schématu druhu `bodies`, `topo` nebo `region` (v pořadí schématu), jinak `null`; `edit` začíná s `null` (R19).
  - `app`: `createBrowserModel({ doc, ops, regen, selection, editor: features })`; odběr `browser.hidden` → `viewport.setBodyVisible` beze změny.
  - `Browser.vue`: jméno `row.userName ?? t(row.name.key, { n: row.name.n })`; dvojklik na jméno = vložené pole jako v `TimelineItem` (Enter/opuštění potvrdí `browser.rename`, Esc zruší; stav editace je jen stav komponenty); oko a přejmenování zakázané, když `session.locked`.
  - `RefListField.vue` u druhu `bodies`: pod tlačítkem seznam vybraných těles (čip se jménem `session.browser.refLabel(ref.body)`; `null` → `t('field.refs.missing')` a styl chyby). Jméno je z dokumentu, ne z řádků Prohlížeče: náhled booleanu nástroj z mapy těles odebere, čip ho přesto musí pojmenovat. Čip má tlačítko × (`aria-label` `t('field.refs.remove', { name })`), které vyšle `update` s hodnotou bez té položky. U `topo` zůstává jen počet.
  - **Překlady vlny B** (jen tento úkol): `browser.rename` „Přejmenovat těleso“ / “Rename body”; `field.refs.missing` „Chybí těleso“ / “Missing body”; `field.refs.remove` „Odebrat {name}“ / “Remove {name}”.
- **Testy:** `BrowserModel` – viditelnost a jméno z metadat dokumentu, `setVisible`/`rename` dispatchnou operace (log), undo vrátí stav, neznámé těleso nic, během transakce nic, stejná hodnota nic, `hidden` jen pro tělesa poslední regenerace, `select` s aktivním parametrem `bodies` mění parametr session a ne výběr, bez aktivního parametru výběr; `refLabel` – jméno z metadat, jméno featury původu, přípona ` (2)` u `bodyId(f, 2)`, smazaná featura → `null`; `FeatureEditor.create` aktivuje první referenční parametr (testovací schéma), u schématu bez referencí `null`, `edit` `null`; `refPick` dál funguje přes `toggleBodyRef` (stávající testy); `app` session test: Prohlížeč dostane `doc` a `ops` (skrytí přes model se uloží do dokumentu).
- **Hotovo když:** testy a `npm run check` projdou; e2e M10 beze změny.

### Vlna C

#### Ú8 `app`, `tests`, `e2e`: registrace a scénář
- **Soubory:** `src/app/plugins.ts`, `src/app/plugins.test.ts`; `tests/boolean-scenario.test.ts` (nový); `e2e/m11.spec.ts` (nový; pomocné funkce smí přesunout ze `smoke.spec.ts` do `e2e/helpers.ts`).
- **Kontrakt:** `BUILT_IN_PLUGINS = [boxPlugin, cylinderPlugin, transformPlugin, booleanPlugin]` (pořadí = pořadí v Toolbaru ve skupině).
- **Testy:**
  - `plugins.test.ts`: obsahuje čtyři pluginy, session se otevře (úplné registry, žádné kolize klíčů ani zkratek).
  - `tests/boolean-scenario.test.ts` (FakeKernel, dokument, dispečer, log, `Regenerator`, `FeatureEditor`, `createFeatureTreeModel`, vestavěné akce s falešným `confirm`, jako `feature-dialog.test.ts`): kvádr, válec (osa z, prochází kvádrem), boolean `subtract` (cíl kvádr, nástroj válec) → jedno těleso s id kvádru a `lastModifiedBy` booleanu; změna poloměru válce → id výsledku stejné; smazání válce akcí `feature.delete` → `confirm` dostane `n: 1`; po potvrzení boolean `UNRESOLVED_REFERENCE` s `issues` `param.unresolvedRef` u `tools`, kvádr `ok`, jedno těleso (kvádr); undo → válec zpět, boolean `ok`; `confirm` → `false` nic nesmaže; přehrání logu do nového dokumentu (`replayLog`) dá stejný `toData`.
  - `e2e/m11.spec.ts` (OCCT v prohlížeči, česky): kvádr, válec, Boolean – v dialogu je aktivní pole Cíle, klik na „Těleso 1“ v Prohlížeči, klik na pole Nástroje, klik na „Těleso 2“, operace Rozdíl, OK → „Tělesa: 1“, bez chyb; reload → stejné; smazání válce (výběr v Timeline, klávesa Delete, `page.once('dialog', d => d.accept())` – Playwright jinak dialog zamítne) → „Chyby: 1“, boolean má v popisu „Odkazované těleso neexistuje“, „Tělesa: 1“; Zpět → text „Chyby: 1“ zmizí a „Tělesa: 1“ zůstane; skrytí tělesa okem a reload → těleso zůstane skryté (tlačítko „Zobrazit“).
- **Hotovo když:** `npm run check`, `npm run test:integration`, `npm run build` a `npm run test:e2e` projdou.

### Vlna D

#### Ú9 Hlavní sezení
- Zkontrolovat kód Ú1–Ú8 proti specifikacím, propsat odchylky (06, 07, 03, 04, 10, 11), převést otázky implementátorů.
- Měřítko rozšiřitelnosti do retrospektivy: `git diff --stat` mimo `src/features/*`, rozdělené na (a) kvůli novým entitám – očekáváno jen jádro (Ú1), registrace (Ú8) a obecná kontrola duplicit (Ú2, `param.duplicateRef`); (b) kvůli úkolům z revize – Ú2 metadata, Ú3, Ú7. Každý soubor zdůvodnit.
- `architecture-reviewer`, oprava nálezů, retrospektiva, poznatky, `/milnik konec M11`, commit.

- [x] Ú9a Oprava nálezů revize v prezentační vrstvě (přejmenování a `canEdit` v `BrowserModel`, `FieldState.refs` a `removeRef`, úzké závislosti editoru)

## Co se naučíš

- Jak se mění port jádra, aby obě implementace (AABB fake a OCCT) splnily jeden kontrakt, a co do kontraktu nepatří (počet ploch, objem).
- Proč tuhý pohyb v OCCT jen nastaví lokaci a geometrii nekopíruje (`BRepBuilderAPI_Transform` s `copyGeom = false`).
- Identita tělesa jako rodokmen v praxi: co dědí Transform a Boolean a proč metadata těles teprve teď smí do dokumentu.
- Graf závislostí z referencí: potvrzení mazání a hlídání pořadí jako prezentační logika, ne pravidlo handleru.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_Návrh (noční rychloakce, Pavel doplní nebo upraví)._

**Měřítko rozšiřitelnosti** (`git diff 31874e7..HEAD` mimo `src/features/*`):

(a) **Kvůli novým entitám**
- Port jádra a jeho dvě implementace: `kernel/kernel.ts`, `fake-kernel.ts`, `testing.ts` (kontraktová sada), nový `transform.ts` (`isRigidMotion`), `index.ts`; `kernel-occt/occt-kernel-impl.ts` a přeposílání v `client.ts`, `worker-impl.ts`, `index.ts`. Očekávané: nová geometrie = nové operace jádra. Protokol workeru se odvozuje z portu, takže přeposílání je po jednom řádku na metodu.
- `regen/builder.ts` (`ModelingKernel` o `TransformOps` a `BooleanOps`, pomocník `unresolvedReference`) a `tracking-kernel.ts` (sledování nových handle). Očekávané: builder smí jen to, co mu `regen` dá.
- `document/validate.ts` (`param.duplicateRef`, R12) a klíče `param.*` v `ui/i18n`: obecné pravidlo pro všechny referenční parametry, první spotřebitel je Boolean.
- Registrace: `app/plugins.ts`; testovací jádro v `app/testing.ts` (doplnění nových metod portu).
- **Žádná** změna v `ops`, `persistence`, `render` ani v `ui` komponentách kvůli Cylinder/Transform/Boolean samotným: dialog, Timeline, ikony i překlady přišly z pluginů.

(b) **Kvůli úkolům z revize architektury**
- Metadata těles: `document` (`model`, `refs`, `serialize`, `cad-document`, `document`), `ops` (`handlers/body.ts`, `operation.ts`, `handler.ts`), Prohlížeč (`interaction/browser-model.ts`, `ref-values.ts`, `ui/components/Browser.vue`).
- Závislosti featur: `interaction/feature-tree.ts`, `builtin-actions.ts` (potvrzení), `app/session.ts`, `browser.ts`, `ui/App.vue`, `TimelineItem.vue`.
- Výběr referencí v dialogu: `interaction/feature-editor.ts` (`FieldState.refs`, `removeRef`, první referenční parametr aktivní), `ui/components/params/RefListField.vue`, `FeatureDialog.vue`.

**Co bylo jinak, než se čekalo**
- Nová entita opravdu nepotřebovala nic mimo jádro a registraci – kostra z M10.1 (reference, id těles jako rodokmen, `refPick` s filtrem) se vyplatila. Drahé bylo rozšíření portu jádra: jedna operace = Fake + OCCT + kontraktová sada + přeposílání + sledování v `regen`.
- Revize našla jen věci v prezentační vrstvě: plán sám povolil stav přejmenování v komponentě a čtení surové hodnoty parametru v `ui`. Pravidlo „logika v presenteru“ ([[0010-prezentacni-model|ADR 0010]]) je potřeba hlídat už při psaní plánu, ne až při revizi.
- Výchozí hodnoty pluginů s povinnými referencemi validací neprojdou (R24) – společný test pluginů se musel upravit.
- Zúžení (⚠ v [[Rozhodnutí noční rychloakce]]): boolean dává vždy jedno těleso (R8, rozpad v M14), rotace jen kolem os přes počátek (R6), žádné zvýraznění vybraných těles během dialogu (R19).

**Co se osvědčilo**
- Vlny s vlastníky sdílených souborů: 9 úkolů, 4 souběžně, slučování patchem bez konfliktu.
- E2E výběrem těles přes Prohlížeč místo kliků do canvasu: test nezávisí na kameře.

