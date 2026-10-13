---
type: moc
status: active
aliases:
  - Noční rychloakce
  - Rychloakce M11–M15
tags:
  - plan
created: 2026-10-14
updated: 2026-10-14
---
# Rozhodnutí noční rychloakce

Pavel 2026-10-14 večer: „implementuj všechny milníky kromě posledního (vlastní OCCT), rozhoduješ dobře, jen ta rozhodnutí zapisuj“. Milníky [[M11-dalsi-entity|M11]]–[[M15-export-a-dokonceni|M15]] proto běží bez průběžného schvalování. **Tady je průběžný seznam všeho, co jsem rozhodl sám**, aby šlo ráno projít, co zpochybnit. Podrobnosti jsou u rozhodnutí v odkazované otázce, ADR nebo specifikaci; tady je jen jedna věta a proč.

Postup se oproti [[Roadmapa|roadmapě]] nemění: plán a kontrakty ve vaultu → úkoly přes `implementer` → kontrola → `npm run check` → commit po milníku. Zkrácené je jen schvalování: rozhodnutí, která by čekala na Pavla, dělám sám a zapisuji sem.

Značka **⚠ k revizi** = rozhodnutí, u kterého si nejsem jistý nebo které zužuje rozsah; tam se vyplatí podívat nejdřív.

## Obecné

- **R1 – Předpřipravený OCCT build stačí až do M15.** Ověřeno v `replicad_single.d.ts`: je tam `BRepPrimAPI_MakeCylinder`, `BRepAlgoAPI_Fuse/Cut/Common`, `BRepBuilderAPI_Transform`, `BRepPrimAPI_MakePrism/MakeRevol`, `BRepFilletAPI_MakeFillet/MakeChamfer`, `STEPControl_Writer` s `FS`, `BRepBuilderAPI_MakeWire/MakeFace/MakeEdge` a historie `Modified/Generated/IsDeleted` na `BRepBuilderAPI_MakeShape`. [[M16-vlastni-occt-build|M16]] proto zůstává poslední ([[0013-replicad-opencascadejs|ADR 0013]]).
- **R2 – Řešič vazeb `@salusoft89/planegcs`** (1.3.0, aktivně udržovaný) podle [[12-skicar|spec 12]]; ověří se spikem na začátku M12.

## M11 – Další entity

Plán a kontrakty: [[M11-dalsi-entity#Implementační plán]]. R3, R4, R8 a R16 zadalo hlavní sezení, ostatní rozhodl plánovač milníku.

- **R3 – `FakeKernel` zůstává AABB.** Válec = jeho AABB (pro libovolnou osu), transform = AABB transformovaných rohů, union = obalový AABB, subtract = AABB cílů beze změny, intersect = průnik AABB (prázdný → `'operation-failed'`), síť dál jako kvádr. Proč: testy vyšších vrstev potřebují jen identitu a bbox; skutečnou geometrii ověřuje OCCT ([[06-geometricke-jadro#`FakeKernel`]]).
- **R4 – Kontraktová sada testuje jen to, co platí pro obě jádra** (bbox s tolerancí 1e-5, validní síť, chyby vstupu); počet ploch válce, objem a „rozdíl, který cíl celý odebere“ jsou testy `kernel-occt`. Proč: fake nic neodečítá, společný kontrakt by jinak lhal ([[06-geometricke-jadro#Testy]]).
- **R5 – Osa válce jako enum `'x' | 'y' | 'z'`, port bere `axis: Vec3`.** Proč: `ParamSpec` nemá druh „směr“ a enum je v dialogu nejjednodušší; port zůstává obecný podle spec 06, převod dělá builder ([[M11-dalsi-entity#Ú4 `features/cylinder`: plugin Cylinder|Ú4]]).
- **R6 – Transform: `bodies`, posun `translate` (bod), rotace `axis` (x/y/z) + `angle`; matice `T · R`, rotace kolem osy přes počátek světa.** ⚠ k revizi: rotace kolem vlastní osy tělesa nebo vybrané hrany by byla intuitivnější, ale potřebuje výběr hran (M14). Proč takhle: nejmenší parametrizace, kterou zvládne stávající dialog ([[M11-dalsi-entity#Ú5 `features/transform`: plugin Transform|Ú5]]).
- **R7 – `TransformOps.transform` přijímá jen tuhý pohyb** (`isRigidMotion`, jinak `'invalid-input'`); a `ModelingKernel` dostává `TransformOps` a `BooleanOps` už v M11 (spec počítala s M13). Proč: zrcadlení by otočilo navinutí sítě a měřítko kopíruje geometrii; Transform v M11 nic jiného nepotřebuje ([[06-geometricke-jadro#Stav po M11]]).
- **R8 – Výsledek booleanu je v M11 vždy jedno těleso** (jeden handle, případně compound), dědí `id`, `origin`, `names` prvního cíle, `lastModifiedBy` = boolean; ostatní cíle a nástroje (bez `keepTools`) zmizí. ⚠ k revizi: nenaplňuje požadavek revize „více výsledných solidů → `bodyId(cíl.origin, n)` podle rodokmenu“; proč: rodokmen solidů potřebuje historii jádra, která vzniká až v M14 – úkol je zapsaný v [[M14-topologicke-pojmenovani#Úkoly z M11]] ([[07-regenerace#Builder featury]]).
- **R9 – Boolean má dva seznamy `targets` a `tools` (oba min 1) pro všechny operace; union slije nástroje do prvního cíle.** ⚠ k revizi: Onshape má u sjednocení jediný seznam. Proč: jedno schéma bez podmíněných parametrů (ty přijdou až v M13), stejná pravidla identity pro všechny tři operace ([[M11-dalsi-entity#Ú6 `features/boolean`: plugin Boolean|Ú6]]).
- **R10 – Prázdný výsledek booleanu je `'operation-failed'` v obou jádrech** (OCCT: žádný solid nebo `HasErrors()`). Proč: prázdné těleso by se rozbilo až v tessellaci; chyba featury `KERNEL` je čitelnější ([[06-geometricke-jadro#Kontrakt (platí pro každou implementaci)]]).
- **R11 – `UNRESOLVED_REFERENCE` nese `issues` `[{ param, code: 'param.unresolvedRef' }]`** přes pomocníka `unresolvedReference` v `regen`. Proč: Timeline už překládá `issues` z chyby featury, takže chybějící těleso se ukáže česky u parametru bez změny `interaction` a `app` ([[07-regenerace#Stav featury]]).
- **R12 – Duplicitní reference hlídá obecně `validateAgainstSchema` (`param.duplicateRef`), překryv cílů a nástrojů vlastní pravidlo booleanu (`boolean.sameBody`).** Proč: duplicita je chyba každého referenčního parametru; vztah mezi dvěma parametry zná jen featura ([[03-dokument#Schéma featury]]). Jediná změna mimo `features/*` motivovaná novou entitou, která není jádro ani registrace – zapíše se do měřítka.
- **R13 – Metadata těles (jméno, skrytí) v dokumentu, operace `body.rename` a `body.setVisible` v logu i v undo** ([[Q071 Viditelnost těles|Q071]] přehodnocena). ⚠ k revizi: undo skrývání (Fusion ho do undo nedává). Proč: identita je od M10.1 rodokmen, takže metadata se po změně historie nepřenesou; co se ukládá, jde přes operaci ([[03-dokument#Metadata těles]]).
- **R14 – Během otevřeného dialogu a v režimu jen pro čtení nejde měnit viditelnost ani jméno tělesa.** ⚠ k revizi: zúžení oproti M10 (stav pohledu šel měnit vždy). Proč: operace nesmí do cizí transakce a čtecí dispečer je odmítá; výběr těles do dialogu jde i přes Prohlížeč (R19), takže skrývání při výběru není nutné ([[10-interakce#Prohlížeč: `BrowserModel` a viditelnost těles]]).
- **R15 – Q017: skrývání podle R13, průhlednost a barva odloženy do M15** jako nová [[Q073 Průhlednost a barva těles|Q073]]. Proč: v M11 nemají spotřebitele ([[Q017 Průhlednost a skrývání těles|Q017]]).
- **R16 – Potvrzení mazání „N featur ztratí referenci“ přes port `confirm` do vestavěných akcí, v UI `globalThis.confirm`.** Proč: nejmenší správné řešení – `interaction` nezná DOM, dialogová komponenta v UI není a nativní dialog už používá mazání dokumentu ([[10-interakce#Vestavěné akce]]).
- **R17 – `FeatureTreeModel.move` vzniká bez UI tažení v Timeline**; odmítá jen **nová** porušení pořadí. ⚠ k revizi: zúžení, tažení featur přijde, až bude potřeba. Proč: pravidlo je malé a testovatelné v Node, tažení je samostatná UI práce mimo téma M11 ([[10-interakce#Strom featur: `FeatureTreeModel`]]).
- **R18 – Řádek Timeline nese `dependents` a tooltip ukazuje „Závisí na ní: N“.** Proč: požadavek revize, levný díky `dependenciesOf` z M10.1 ([[11-ui#Komponenty]]).
- **R19 – Výběr referencí v dialogu: první referenční parametr je po `create` aktivní, těleso jde vybrat i klikem v Prohlížeči a `RefListField` ukazuje čipy těles s ×.** ⚠ k revizi: zvýraznění vybraných těles ve viewportu během dialogu v M11 není (`HighlightTarget` nemá variantu celého tělesa). Proč: bez seznamu těles v poli nejde Boolean rozumně ovládat a výběr z Prohlížeče dělá e2e test deterministický ([[10-interakce#Dialog featury: `FeatureEditor`]]).
- **R20 – Nástroje:** Válec `group: 'primitive'`, ikona `cylinder`, zkratka `C`; Transformace a Boolean `group: 'modify'`, ikony `arrows-move` a `layers-union`, bez zkratek. Výchozí válec poloměr 5, výška 10, osa Z. Proč: `C` je volné, u úprav Onshape zkratky nemá ([[M11-dalsi-entity#Vlna B]]).
- **R21 – Normály válce zatím průměrem z trojúhelníků plochy, ne z triangulace OCCT.** Proč: síť je platná a objem sedí, rozdíl je jen kosmetický na švu pláště; přesná cesta se doplní, až bude vadit ([[06-geometricke-jadro#Tessellace v adaptéru]]).
- **R22 – `BodyId` deklarovaný v `document/model.ts`** (dál exportovaný z `refs.ts`). Proč: import z `refs.ts` by udělal cyklus `model ↔ refs`, který dependency-cruiser odmítne; zvenku se nic nemění.
- **R23 – Maže-li se featura spolu se všemi závislými, potvrzení se nezobrazí** (`n = 0`). Proč: nikdo referenci neztratí ([[10-interakce#Vestavěné akce]]).
