---
type: adr
status: accepted
number: 15
aliases:
  - ADR 0015
  - Artefakty a identita tělesa
date: 2026-10-14
related:
  - "[[07-regenerace]]"
  - "[[03-dokument]]"
  - "[[0006-nemenna-data]]"
  - "[[0007-vlastni-topologicke-pojmenovani]]"
  - "[[M10.1-zpevneni-kostry]]"
supersedes:
tags:
  - adr
created: 2026-10-14
updated: 2026-10-14
---
# 0015 – Artefakty ve stavu regenerace a identita tělesa jako rodokmen

- **Stav:** Přijato (`status: accepted`, Pavel potvrdil předpoklady plánu M10.1 2026-10-14)
- **Datum:** 2026-10-14
- **Souvisí:** [[07-regenerace]], [[03-dokument]], [[0006-nemenna-data|ADR 0006]], [[0007-vlastni-topologicke-pojmenovani|ADR 0007]], [[Revize architektury 2026-10-13]]

## Kontext

[[Stav regenerace|Stav regenerace]] byl do M10 mapa [[Těleso|těles]] a nic jiného. Skica ([[12-skicar]]) těleso nevytváří, ale Extrude potřebuje její profily a rovinu; konstrukční roviny a osy, křivky a vzory také nejsou tělesa. Builder vidí jen vlastní featuru a vstupní stav, takže všechno, na co se pozdější featury odkazují, musí být ve stavu. Onshape drží v Part Studiu jeden kontext všech druhů entit a reference jsou dotazy nad ním; Fusion ukazuje v Prohlížeči tělesa, skici i konstrukci vedle sebe.

Identita tělesa byla konvence v builderu (`` `${feature.id}/body` as BodyId ``) s polem `createdBy`. U featur s více výstupy by pořadové číslo podle pořadí z jádra bylo nestabilní (stejný problém jako [[Topologické pojmenování|topologické pojmenování]], o úroveň výš) a po Booleanu nebo Transformu je „kdo těleso vytvořil“ dvojznačné. Bez stabilní identity nejde k tělesu uložit jméno, barvu ani viditelnost ([[Q071 Viditelnost těles|Q071]]).

## Rozhodnutí

1. **Stav regenerace je jedna mapa artefaktů** `RegenState.artifacts: ReadonlyMap<ArtifactId, Artifact>` s diskriminací podle `kind`. V M10.1 je jediný druh `body`; M12 přidá `sketch` a počáteční roviny a osy jako artefakty vyhrazeného vlastníka `origin`. Jedna mapa místo mapy na druh: nový druh přidá člena sjednocení a vykreslovač, ne pole ve stavu, v portu a v Prohlížeči.
2. **Id artefaktu je vždy `<vlastník>/<druh>[:<n>]`** a razí ho jediné místo v `document` (`bodyId(origin, n)`), builder nepřetypovává. Vlastník se čte zpět (`originOfBody`, `ownerOf`), takže graf závislostí mezi featurami plyne z referencí bez dalších dat.
3. **Identita tělesa je rodokmen:** `Body { origin, lastModifiedBy }` místo `createdBy`. Featura, která těleso vytváří, razí id; featura, která ho mění (Transform, Fillet, Boolean na cíli), zachová `id`, `origin` a `names` a nastaví `lastModifiedBy`; featura, která ho spotřebuje (nástroj Booleanu), ho z mapy odebere. Pořadové číslo u více výstupů se odvozuje z rodokmenu (z historie jádra `Generated`/`Modified`), ne z pořadí výstupu jádra.
4. Reference ze schématu featury jsou vyjmenovatelné (`referencesOf`) a z nich plyne graf závislostí (`dependenciesOf`, `orderViolations`) jako čisté funkce v `document`; pravidla přesunu a mazání nad ním staví `interaction`.

## Zvažované alternativy

- **Mapa na druh (`bodies`, `sketches`, `planes`…)** – přesnější typy při čtení, ale každý nový druh mění stav, port, adaptér i Prohlížeč. Zamítnuto; přesné typy dávají pomocníci `bodiesOf(state)` a `resolveBodies`.
- **Id podle pořadí výstupu jádra** – jednoduché, ale nestabilní při změně parametrů; stejná chyba, jakou ADR 0007 odmítá u ploch.
- **Metadata tělesa u featury místo tělesa** – stabilní id má featura, ale neodpovídá Prohlížeči, který ukazuje tělesa (varianta 3 v Q071).

## Důsledky

- \+ Skica, roviny a osy mají kam; Prohlížeč seskupí artefakty podle druhu; port a render dostanou jeden kanál.
- \+ K tělesu jde bezpečně uložit jméno a viditelnost (operace `body.*`, M11), protože id přežije změnu historie.
- \+ Graf závislostí umožní pravidla přesunu a mazání (M11) a invalidaci cache při proměnných ([[Q003 Proměnné a výrazy v parametrech|Q003]]).
- − Čtení těles ze stavu jde přes `bodiesOf` nebo kontrolu `kind`; ztráta přesného typu na úrovni mapy.
- − Pravidlo pro více výstupů (Boolean s `keepTools`, Split) musí každý builder dodržet; hlídá to test v M11.
