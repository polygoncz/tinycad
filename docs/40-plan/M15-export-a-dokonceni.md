---
type: milestone
status: todo
order: 15
aliases:
  - M15
  - M15 Export a dokončení
modules:
  - kernel-occt
  - ui
specs: []
depends_on:
  - "[[M14-topologicke-pojmenovani]]"
started: 
finished: 
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-14
---
# M15 – Export a dokončení

**Cíl:** dostat model ven a uzavřít první verzi.

> Hrubý plán – před zahájením upřesnit.

**Navazuje na:** [[M14-topologicke-pojmenovani]]

## Úkoly (orientačně)

- [ ] `ExchangeOps.exportStep` (`STEPControl_Writer`), stažení souboru z UI.
- [ ] Export/import dokumentu `.tinycad.json` v UI.
- [ ] Zobrazení historie úprav (log) jako panel – časová osa operací, včetně undo/redo záznamů.
- [ ] Výkon: měření regenerace a tessellace na větším modelu, případně cache sítí.
- [ ] Úklid: projít otevřené otázky ve všech specifikacích, rozhodnout nebo přesunout do „Další nápady“.

## Úkoly z M14

Odloženo z [[M14-topologicke-pojmenovani|M14]] (rozhodnutí v [[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|M14 – Topologické pojmenování]]); každý bod rozhodnout při upřesnění M15 – udělat, nebo přesunout do „Další nápady“:

- [ ] **Boolean s více výslednými tělesy** ([[07-regenerace#Builder featury]], R8 → R100 ⚠): nový dotaz jádra na rozklad výsledku na solidy s historií, `bodyId(cíl.origin, n)` podle rodokmenu (např. podle nejmenšího jména plochy solidu), ošetření kolize id; test „změna parametru válce nepřehodí id dvou výsledných těles“. Platí i pro „odebrat“ ve Vysunutí (R67).
- [ ] **Automatické cíle vysunutí** „sloučit se vším, čeho se dotkne“ (R66, R109 ⚠): dotaz jádra na průnik (`BRepExtrema_DistShapeShape` je v buildu).
- [ ] **Obecné „Po plochu“** (nerovinná nebo nerovnoběžná plocha, „Po další“) – `BRepFeat_MakePrism` nebo řez hranolem (R109 ⚠).
- [ ] **Vrcholy:** `PickKind 'vertex'`, reference na vrchol (R101 ⚠).
- [ ] **Čipy referencí `topo`** v dialogu s jménem a × (R103 ⚠).
- [ ] **Zkosení dvěma vzdálenostmi / vzdáleností a úhlem, zaoblení s proměnným poloměrem** (R105 ⚠).

## Další nápady (mimo rozsah)

- Vlastní C++ modul OCCT přes Emscripten místo předpřipraveného buildu (výměna adaptéru za portem). → samostatný milník [[M16-vlastni-occt-build]].
- Jádro na serveru jako alternativní adaptér `GeometryKernel`.
- Proměnné a výrazy v parametrech.
- Větvení verzí nad operačním logem.
- Více Part Studií v dokumentu.
- Interaktivní tvorba kvádru tažením ve viewportu (vlastní `Tool`, mezivýsledky přes `FeatureEditSession.setParam`) – přesunuto z [[M09-interakce]] přes [[M13-extrude-revolve|M13]] ([[Rozhodnutí noční rychloakce#M13 – Extrude a Revolve|R79]]).

## Retrospektiva

_(vyplnit po dokončení)_
