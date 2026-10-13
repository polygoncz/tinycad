---
type: milestone
status: done
order: 9
aliases:
  - M9
  - M9 Interakce
modules:
  - interaction
  - plugin-api
specs:
  - "[[10-interakce]]"
depends_on:
  - "[[M08-vykreslovani]]"
started: 2026-10-13
finished: 2026-10-13
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-13
---
# M9 – Interakce

**Cíl:** výběr, nástroje, obecný dialog featury nad transakcí a akce s klávesovými zkratkami. Všechno bez Vue, testované v Node (`FakeViewport`, skutečný dokument a dispečer; integrační test s `FakeKernel`).

**Specifikace:** [[10-interakce|10 – interakce]]

**Navazuje na:** [[M08-vykreslovani]]

## Úkoly

- [x] `FakeViewport` pro testy (předpřipravený `pick`, ruční emit událostí).
- [x] `SelectionModel`.
- [x] `Tool`, `ToolContext`, `ToolDescriptor`, `ToolRegistry`, `ToolManager` (Esc, výchozí nástroj).
- [x] `SelectTool` – hover, klik, Shift+klik, klik do prázdna = zrušit výběr.
- [x] `FeatureEditor` a `FeatureEditSession` – `create`, `edit` (dočasný posun rollback baru), `setParam`, referenční parametry, `commit`, `cancel`.
- [x] `Action`, `ActionRegistry` nad `ViewKeyEvent`, mapování zkratek (`Mod`), ignorování v textových polích.
- [x] [[Prezentační model|Prezentační modely]] ([[0010-prezentacni-model|ADR 0010]]): `FeatureTreeModel` a `Observable` stav u `FeatureEditSession`, `ToolManager`, `ActionRegistry`, `SelectionModel`. Upřesnit tvary `TreeRow`, `FieldState`, `ActionState`.
- [x] `plugin-api`: přidat `tools` do `FeaturePlugin`; `features/box/tool.ts` – nástroj, který otevře dialog.
- [ ] ~~(Volitelné) Interaktivní tvorba kvádru tažením ve viewportu.~~ Odloženo do [[M13-extrude-revolve]] (rozhodnutí 2026-10-13).

## Implementační plán

Každý úkol dělá zvlášť subagent `implementer` (TDD: test nejdřív a ověřit, že padá; `npm run check`). Kontrakt je v [[10-interakce|spec 10]], u Ú2 v [[04-operace-a-historie#Transakce|spec 04]], u Ú9 v [[11-ui#Plugin featury (plugin-api)|spec 11]]. Rozhodnutí: [[Q018 Rollback bar při editaci starší featury|Q018]], [[Q063 Stav regenerace v interaction|Q063]]–[[Q068 Kam se vloží nová featura|Q068]]. Z `interaction` jde ven jen to, co je v `index.ts`. Testy `interaction` smí z cizích `testing.ts` brát jen `core`, `document` a `ops` (na `kernel` ani `regen` nesahají ani v testech).

### Ú1 Porty: `HighlightTarget` a `RegenStatusPort`
- **Soubory:** `src/interaction/viewport-port.ts`, nový `src/interaction/regen-status-port.ts`, `src/interaction/index.ts`, `src/interaction/testing.ts` + test; `src/render/highlight-targets.ts`, `src/render/highlight-layer.ts`, `src/render/viewport.ts` (jen typy).
- **Kontrakt:** [[10-interakce#Port viewportu]] – `HighlightTarget`, `HighlightPort` bere `HighlightTarget`. [[10-interakce#Port stavu regenerace]] – `FeatureHealth`, `RegenSnapshot`, `RegenStatusPort`. `FakeRegenStatus` v `testing.ts`: začíná `{ generation: 0, health: prázdná mapa }`, `publish(health)` vytvoří nový zmrazený snapshot s `generation + 1`. `FakeViewport` zaznamenává `HighlightTarget`.
- **Testy:** `FakeRegenStatus` – počáteční stav, `publish` zvýší generaci a upozorní odběratele, snapshot je zmrazený; stávající testy `render` (`sameTarget`, `validTargets`) projdou s `HighlightTarget`.
- **Hotovo když:** testy a `npm run check` projdou.

### Ú2 Přechodná operace v transakci
- **Soubory:** `src/ops/transaction.ts`, `src/ops/transaction.test.ts` (případně `replay.test.ts`).
- **Kontrakt:** [[04-operace-a-historie#Transakce]] – `Transaction.applyTransient(op)`: aplikace přes `applyOperation`, přechodný krok s inverzí; `commit` nejdřív vrátí přechodné kroky v opačném pořadí (`applied` s `entry: null`), pak komprese a zápis jen logovaných kroků; `abort` vrací všechny kroky v opačném pořadí; transakce jen s přechodnými kroky nic nezapíše.
- **Testy:** `begin` → `applyTransient(setRollback)` → `apply(setParams)` ×3 → `commit` = záznam s jedinou `feature.setParams`, bar zpět na původním místě; totéž s `abort` = dokument i log beze změny; jen přechodné kroky → `null` a bar zpět; selhání handleru v `applyTransient` nechá transakci otevřenou; `replayLog` po commitu dá stejný dokument; `applyTransient` po ukončení vyhodí.
- **Hotovo když:** testy a `npm run check` projdou.

### Ú3 `SelectionModel`
- **Soubory:** `src/interaction/selection.ts` + test, `index.ts`.
- **Kontrakt:** [[10-interakce#Výběr]] – `SelectionItem`, `SelectionModel` s `items: Observable`, `createSelectionModel({ regen })`, `sameSelectionItem`, `bindSelectionHighlight`.
- **Testy:** `set` s duplicitami (první vyhrává), `set` se stejným obsahem nic nevyšle, `toggle` přidá na konec a odebere, `clear` na prázdném nic nevyšle, snapshot zmrazený; nová generace z `FakeRegenStatus` odebere `face`/`edge`, nechá `feature`/`body` (a bez `face`/`edge` nic nevyšle); `bindSelectionHighlight` předá jen `face`/`edge` hned i po změně, po odhlášení už ne.
- **Hotovo když:** testy a `npm run check` projdou.

### Ú4 `ActionRegistry`
- **Soubory:** `src/interaction/actions.ts`, `src/interaction/shortcut.ts` (parsování a porovnání zkratek) + testy, `index.ts`.
- **Kontrakt:** [[10-interakce#Akce a klávesové zkratky]].
- **Testy:** parsování (`Mod+Z`, `Shift+Mod+Z` = `Mod+Shift+Z`, `Delete`, `F2`; neplatné: `Foo+Z`, `Mod+`, `Mod+Mod+Z`, prázdný řetězec); `handleKey` s `mod`, s `Shift` a velkým písmenem, přesná shoda modifikátorů, `inTextField` → `false`, zakázaná akce → `true` bez spuštění, bez zkratky → `false`; `run` neznámé id vyhodí, zakázaná vrátí `false`; duplicitní id a zkratka vyhodí; změna `enabled` → nový snapshot, ostatní `ActionState` identické; `dispose` odhlásí.
- **Hotovo když:** testy a `npm run check` projdou.

### Ú5 `ToolRegistry`, `ToolManager`, `SelectTool`
- **Soubory:** `src/interaction/tools.ts` (typy, registr), `src/interaction/tool-manager.ts`, `src/interaction/select-tool.ts` + testy, `index.ts`.
- **Kontrakt:** [[10-interakce#Nástroje]] a [[10-interakce|spec 10]], sekce *SelectTool* **bez** zakrytí nástrojem `refPick` (to je Ú7). `ToolContext.features` je typ `FeatureEditor` z Ú6; pokud Ú6 ještě není, deklaruj zatím jen rozhraní `FeatureEditor`/`FeatureEditSession`/`EditState`/`FieldState` v `src/interaction/feature-editor.ts` podle spec a v testech použij ruční stub.
- **Testy:** výchozí nástroj aktivní hned po vytvoření; neznámé `defaultToolId` vyhodí; `activate` deaktivuje předchozí, stejné id nic, neznámé vyhodí a nechá aktivní; `finish` uvnitř `activate` → po návratu výchozí; `finish` starého `ctx` nic; `Escape` ukončí nevýchozí, nástroj s `onKey → true` ho zachytí; `unhandledKey` dostane ostatní; `dispose`. `SelectTool` s `FakeViewport` podle tabulky ve spec (hover, `leave`, klik, Shift, prázdno, tažení nad 4 px, pravé tlačítko, `Escape`, `deactivate`).
- **Hotovo když:** testy a `npm run check` projdou.

### Ú6 `FeatureEditor` a `FeatureEditSession`
- **Soubory:** `src/interaction/feature-editor.ts` (+ případně `feature-name.ts`) + test, `index.ts`.
- **Kontrakt:** [[10-interakce|spec 10]], sekce *Dialog featury* – `create`, `edit` s přechodným posunem baru (Ú2), session, `EditState`, `FieldState`. Testy se skutečným dokumentem (`createDocument`), registrem handlerů a dispečerem; schéma z builderu `document/testing.ts` nebo ručně v testu.
- **Testy:** create → `setParam` ×20 → commit = **1 záznam** v logu (`batch[feature.add, feature.setParams]`); cancel = dokument i log beze změny (porovnat `toData`); jméno `Box 1`, `Box 2`, mezera po smazané `Box 1` → `Box 1`; vložení na bar uprostřed, bar za novou featurou; edit featury před barem i za barem: během session bar na `index + 1`, po commit i cancel na původním místě, v logu není `studio.setRollback`; edit, když je bar už na `index + 1` → žádná přechodná operace; neplatná hodnota → `issues` a `FieldState.issue`; neznámý parametr vyhodí; `focusRefParam` na nereferenční parametr vyhodí; druhá session vyhodí; příkazy po zavření vyhodí; `current` přechází session → `null`; `UndoManager.canUndo()` během session `false`.
- **Hotovo když:** testy a `npm run check` projdou.

### Ú7 Referenční parametr: nástroj `refPick`
- **Soubory:** `src/interaction/ref-pick-tool.ts`, `src/interaction/tool-manager.ts` + testy.
- **Kontrakt:** odstavec *Referenční parametr dialogu* v [[10-interakce#Nástroje]]. Převod pick → reference v M9 jen pro `bodies` (`{ body }`, přidat/odebrat, bez duplicit); pro `topo` a `region` `refPick` klik ignoruje (doplní M13/M14).
- **Testy:** session s parametrem `bodies` a `focusRefParam` → události jdou `refPick`, aktivní nástroj nic nedostane a `active` se nezmění; klik na těleso přidá `{ body }`, druhý klik ho odebere; `Escape` zruší fokus a události jdou zpět; zavření session během fokusu vrátí události aktivnímu nástroji a zruší hover.
- **Hotovo když:** testy a `npm run check` projdou.

### Ú8 `FeatureTreeModel`
- **Soubory:** `src/interaction/feature-tree.ts` + test, `index.ts`.
- **Kontrakt:** [[10-interakce|spec 10]], sekce *Strom featur*.
- **Testy:** řádky po přidání featury (`pending`, po `publish` `ok`); chyba regenerace → `error` se zprávou; potlačení → `suppressed` i s chybou v `health`; posun baru → `rolledBack`; nový snapshot je nový objekt a nezměněné řádky identické, beze změny žádná emise; `selected` podle výběru, `editing` podle session; `rename` ořízne mezery, prázdné/stejné nic; `moveRollbackBar` stejný index nic, mimo rozsah vyhodí; `select` s `additive`; neznámý typ → `typeLabel = type`; `dispose` odhlásí.
- **Hotovo když:** testy a `npm run check` projdou.

### Ú9 `plugin-api.tools`, nástroj kvádru, integrační test
- **Soubory:** `src/plugin-api/plugin.ts`, `src/plugin-api/register.ts` + test, `src/features/box/tool.ts`, `src/features/box/index.ts`, `src/features/box/box.test.ts`, `dev/viewport.ts` (nový parametr `registerPlugin`), `tests/feature-dialog.test.ts`.
- **Kontrakt:** [[11-ui|spec 11]], sekce *Plugin featury* – `FeaturePlugin.tools?`, `registerPlugin` s `tools: ToolRegistry`, duplicitní id nástroje vyhodí před registrací čehokoli. `boxTool: ToolDescriptor` (`id 'box'`, `label 'Box'`, `icon 'box'`, `group 'primitive'`): při `activate` zavolá `ctx.features.create('box')`, je-li `current` prázdné, a pak `finish()`.
- **Testy:** registrace nástrojů, duplicita v pluginu i proti registru nic nezaregistruje; `boxTool` s `ToolManager` a stub `FeatureEditor` → `create('box')` a návrat k výchozímu; s otevřenou session jen skončí. Integrační test: dokument + dispečer + `createRegenerator` s `FakeKernel` + `FeatureEditor`: create box → `setParam('height', …)` → regenerace dá těleso s novou výškou (živý náhled) → commit = 1 záznam; cancel → žádné těleso.
- **Hotovo když:** testy, `npm run test:integration` a `npm run check` projdou.

### Ú10 Ověření a revize (hlavní sezení)
Projít akceptační kritéria, spustit `architecture-reviewer`, propsat odchylky do specifikací.

## Akceptační kritéria

- `FeatureEditSession`: create → 20× setParam → commit = 1 záznam v logu; cancel = beze změny.
- Úprava existující featury za rollback barem posune bar dočasně a po commit/cancel ho vrátí.
- `interaction` neimportuje `regen`, `kernel`, `render`, `ui` a nepoužívá DOM (projde `tsconfig.domain.json`).
- Celá logika stromu featur je testovaná v Node přes `FeatureTreeModel`, bez Vue.

## Co se naučíš

Stavové automaty nástrojů, oddělení „co uživatel dělá“ od „co se děje s dokumentem“.

## Retrospektiva

_Návrh Clauda, Pavel doplní nebo upraví._

**Co bylo jinak, než se čekalo**
- Spec 10 vypadala před startem hotově, ale při čtení proti kódu se ukázalo 6 děr (Q063–Q068): hlavně jak se `interaction` dozví o regeneraci, aniž by znal `regen`, a nesoulad `PickResult` vs. výběr bez bodu zásahu. Řešení bylo pokaždé stejné – port, který si definuje spotřebitel.
- Q018 (dočasný posun baru) se nedal udělat přes `merge`, protože páry `setRollback` v transakci nesousedí. Vznikl obecný pojem *přechodná operace* (`applyTransient`) v `ops`.
- Zvláštní nástroj `refPick` (Q066) by vedl k cyklu `FeatureEditor` ↔ `ToolManager`. Vyřešilo to otočení směru: `ToolManager` poslouchá editor.
- Implementátoři vrátili po každém úkolu 2–5 děr ve spec (chování po `dispose`, selhání nástroje při aktivaci, verze operací natvrdo). Spec se tak průběžně zpřesňovala – rozdělení spec/implementace fungovalo jako revize kontraktu.
- `architecture-reviewer` našel, že veřejné `Observable` jdou přetypováním přepsat a že spotřebitelé dostávají víc API, než potřebují (`dispose`, `register`). Opraveno `asObservable()`, `RegistryReader`, `SelectionCommands`; otázka k `ToolContext.ops` odložena ([[Q069 Smí nástroj otevřít vlastní transakci|Q069]]).

**Co se osvědčilo**
- Paralelní implementátoři na disjunktních souborech (Ú1+Ú2, Ú3+Ú4, Ú7+Ú8) bez worktree; jediný sdílený soubor `index.ts` se jen doplňoval.
- Testy prezentačních modelů se skutečným dokumentem a dispečerem místo mocků; `FakeKernel` jen v integračním testu v `tests/`.
- Tažení kvádru odloženo do [[M13-extrude-revolve]] – milník zůstal úzký.

**Výsledek:** 1379 unit testů + 2 integrační, `npm run check` zelený.
