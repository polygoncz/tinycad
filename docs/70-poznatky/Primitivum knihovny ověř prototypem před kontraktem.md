---
type: insight
status: seed
aliases: []
topics:
  - "[[12-skicar]]"
sources:
  - "[[M29-spliny]]"
tags:
  - poznatek
created: 2026-10-16
updated: 2026-10-16
---
# Primitivum knihovny ověř prototypem před kontraktem

**Shrnutí:** když kontrakt stojí na konkrétní vazbě nebo konstruktoru cizí knihovny (planegcs, OCCT), stojí za to ji před zapsáním kontraktu zkusit v pěti řádcích testu. Název a typy neřeknou, jak se primitivum chová v krajních případech.

## Podrobnosti

V [[M29-spliny|M29]] kontrakt počítal se třemi věcmi z planegcs a všechny tři se při implementaci ukázaly jinak, než slibovaly typy:

- `tangent_at_bspline_knot` na krajním uzlu skončí `Failed`, protože vazba počítá jen s vnitřním uzlem (stejně jako FreeCAD).
- Wrapper ke splinu s vazbou založí 4 nepoužité proměnné, takže `dof` vyjde o 4 vyšší.
- Volný parametr `point_on_bspline` řešič neomezí na [0, 1] a bod uteče na polynomiální prodloužení. Řešič typu GCS umí rovnice, nerovnosti ne.

Na straně OCCT naopak stačilo projít typy buildu (`Geom_BSplineCurve`, pole `NCollection_Array1_*` s dolní mezí 0) a kontraktové testy to potvrdily. Rozdíl: OCCT má dlouho ustálenou sémantiku, wrapper planegcs je tenká vrstva s vlastními zvláštnostmi.

Každé zjištění stálo jedno kolo „implementátor se zastaví → otázka → rozhodnutí → znovu“ ([[Q087 Spline v řešiči a v jádře – zjištění z implementace|Q087]]). Prototyp při psaní kontraktu by to stáhl do jednoho kola.

## Jak to využívá tinycad

- U zvláštnosti knihovny, na které stojí chování, má adaptér hlídací test surového chování knihovny (např. `dof` fit-splinu = 2 · fit + 4). Když upgrade knihovny chování změní, test selže a oprava se nezapočítá dvakrát.
- Do implementačního plánu patří u rizikových úkolů krok „nejdřív ověř“, a když ověření nevyjde, „vrať otázku, neobcházej“. V M29 to u úkolů 4 a 8b zachytilo všechna tři zjištění dřív, než vznikl kód.

## Zdroje

- [[M29-spliny]], [[Q087 Spline v řešiči a v jádře – zjištění z implementace|Q087]], [[12-skicar#Spliny (M29)]]
