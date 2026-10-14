---
type: adr
status: accepted
number: 21
aliases:
  - ADR 0021
  - Manipulátory – kotvy z regenerace a deklarace v pluginu
date: 2026-10-14
related:
  - "[[07-regenerace]]"
  - "[[09-vykreslovani]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
  - "[[M18-manipulatory]]"
  - "[[0008-hranice-modulu]]"
  - "[[0010-prezentacni-model]]"
supersedes:
tags:
  - adr
created: 2026-10-14
updated: 2026-10-14
---
# 0021 – Manipulátory: kotvy z regenerace a deklarace v pluginu

- **Stav:** Přijato (`status: accepted`, Pavel 2026-10-14)
- **Datum:** 2026-10-14
- **Souvisí:** [[07-regenerace#Kotvy manipulátorů (M18)]], [[10-interakce#Manipulátory (M18)]], [[09-vykreslovani#Manipulátory (M18)]], [[11-ui#Plugin featury (plugin-api)]], [[M18-manipulatory|M18]]

## Kontext

Pavel chce ve viewportu [[Manipulátor|manipulátory]]: úchyty, kterými se tažením myši mění parametry otevřené featury. Začíná se Transformací (posun a rotace) a Extrude (vzdálenost), později přijdou Revolve (úhel) a další featury. Řešení tedy musí být obecné. Přidat manipulátor do další featury nemá vyžadovat změnu v `render` ani v `interaction`.

Omezení z dosavadní architektury:

- `interaction` nezná `regen` ([[0008-hranice-modulu|ADR 0008]]). [[Stav regenerace|Snapshot regenerace]] (`RegenSnapshot`) dnes nenese žádnou geometrii, jen zdraví featur, tělesa s jmény a skici.
- Manipulátor ale geometrii potřebuje: střed obálky vstupních těles (pivot Transformace), rovinu skici a těžiště oblastí (Extrude), později osu (Revolve). Tuto geometrii už zná jen [[Builder featury|builder]], který reference řeší během regenerace.
- Regenerace je asynchronní a v OCCT trvá desítky až stovky ms. `RegenScheduler` mezilehlé změny slučuje. Úchyt, který by čekal na výsledek regenerace, by se za kurzorem táhl.
- Živý náhled už existuje: `FeatureEditSession.setParam(s)` zapisuje do otevřené [[Transakce|transakce]] a transakce při commitu slučuje po sobě jdoucí `feature.setParams` ([[04-operace-a-historie]]). Tažení tak v logu zůstane jednou položkou.

## Rozhodnutí

Manipulátor má dvě poloviny, které se počítají na různých místech:

1. **[[Kotva manipulátoru|Kotva]] (drahá a stabilní geometrie) vzniká v regeneraci.** Builder vrátí vedle stavu i pojmenované kotvy `{ point, direction? }` ve světových souřadnicích (`BuildOutput.anchors`). `Regenerator` je sbírá po featurách (i z cache) do `RegenResult.anchors`, `app` je přepíše do `RegenSnapshot.anchors`.
2. **Úchyty (levná a živá část) se počítají v `interaction`.** Plugin dodá `ManipulatorDescriptor` s čistou funkcí `handles(params, anchors) → Handle[]`. Úchyt nese tvar (`linear`, `angular`), polohu, skalární `value` a `toParams(value) → patch`, tedy čočku nad params. Obecný `ManipulatorController` počítá úchyty při každé změně params, řeší matematiku tažení (paprsek → osa nebo rovina, přichytávání, ořez, Esc) a volá `session.setParams`.
3. **`render` jen kreslí a pickuje.** Port `ManipulatorPort` (člen `ViewportPort`) dostává pohledy úchytů bez funkcí. Glyfy mají konstantní velikost v pixelech, proto picking úchytů dělá `render`.

Invarianty:

- Kotva smí záviset jen na vstupech, které úchyty netáhnou. Poloha úchytu = kotva + **živé** params, takže úchyt jde s kurzorem okamžitě, i když regenerace zaostává.
- Controller na začátku tažení zmrazí kotvy i úchyt. Regenerace, která během tažení selže a kotvy ztratí, tažení nepřeruší.
- Úchyty se ukazují jen při otevřeném dialogu featury s deskriptorem, s kotvami ve snapshotu a s `issues` prázdným (params jsou pak typu `P`).

Typ kotvy definuje `regen`. `interaction` má vlastní strukturálně shodný typ, podobně jako `TopoNames` ([[10-interakce#Port stavu regenerace]]). Deskriptor patří do `interaction` jako `ToolDescriptor` a plugin ho dodá polem `FeaturePlugin.manipulators`.

Je to stejné rozdělení jako ve FeatureScriptu v Onshape: manipulátory vytváří featura během regenerace a oddělená *manipulator change function* převádí pohyb na parametry. Rozdíl je v tom, že tinycad z regenerace bere jen kotvu, ne hotový úchyt, aby poloha úchytu nemusela čekat na OCCT.

## Zvažované alternativy

- **Geometrické dotazy v `interaction`** (`app` dodá službu `boundsOf(bodies)`, `planeOfSketch(…)`): logika by se zdvojila s buildery (Extrude by musel podruhé řešit `flip`, rovinu i oblasti) a API dotazů by rostlo s každou featurou.
- **Hotové úchyty z builderu** (přesně jako Onshape): úchyt by se posunul až po doběhnutí regenerace a při tažení by se za kurzorem táhl.
- **Vlastní `Tool` pro každou featuru:** bez společné abstrakce. Matematika tažení, přichytávání a Esc by se kopírovaly do každé featury.
- **Odvození úchytů ze schématu** (parametr `length` → šipka): schéma neví, kde šipka stojí a kam míří. To je sémantika featury.

## Důsledky

- (+) Nový manipulátor = builder vrátí kotvu a plugin deklaruje úchyty. `render` ani `interaction` se nemění, dokud nepřibude nový druh úchytu.
- (+) Úchyt jde s kurzorem bez zpoždění a celé tažení je v historii jedna položka (slučování `setParams` v transakci).
- (+) Matematika tažení i `handles()` jsou čisté funkce testovatelné v Node.
- (−) `BuildOutput`, cache `Regeneratoru`, `RegenResult` a `RegenSnapshot` dostávají nové pole. Kotvy putují i přes cache.
- (−) Kotvy jsou z poslední dokončené regenerace. Úchyt, jehož kotva by závisela na taženém parametru, by se zpožďoval. Invariant to zakazuje, ale hlídá ho jen revize a testy pluginu.
- (−) Nový druh úchytu (např. rovinný se 2 stupni volnosti) znamená změnu v `interaction` (matematika) i v `render` (glyf, picking).
