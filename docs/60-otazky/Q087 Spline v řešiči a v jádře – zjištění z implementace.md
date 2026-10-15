---
type: question
status: answered
area: "[[12-skicar]]"
decide_by: "[[M29-spliny]]"
proposal: "Tečnost na konci splinu přes point_on_line druhého řídicího bodu; dof fit-splinu opravit odečtením 4 za spline s vazbou planegcs; bspline bez primitivu planegcs; matematiku B-spline přesunout do core/math."
decision: "1a tečnost na konci přes point_on_line druhého řídicího bodu; 2a dof −4 za spline s vazbou planegcs, bspline bez primitivu; 3a matematika v core/math/bspline.ts; 4a samokřížení splinu = crossing"
tags:
  - otazka
created: 2026-10-15
updated: 2026-10-15
---
# Q087 Spline v řešiči a v jádře – zjištění z implementace

**Oblast:** [[12-skicar#Spliny (M29)]], [[06-geometricke-jadro]] · **Rozhodnout do:** [[M29-spliny]]

## Otázka

Při úkolech 4 a 5 [[M29-spliny|M29]] se ukázalo, že kontrakt z [[Q086 Spline přes body v řešiči|Q086]] na třech místech nejde splnit tak, jak je napsaný:

1. **Tečnost na konci splinu.** Planegcs `tangent_at_bspline_knot` na krajním uzlu (multiplicita stupeň + 1) skončí `Failed` s konfliktem i ve volné skice. Stejně se chová FreeCAD: vazba počítá s vnitřním uzlem.
2. **Stupně volnosti fit-splinu.** Wrapper planegcs založí pro každý spline, na který odkazuje vazba (`point_on_bspline`), 4 nové volné parametry pro začátek a konec. Jsou to kopie, ne sdílené proměnné s krajními řídicími body, a žádná rovnice je nepoužívá. Fit-spline ze 4 bodů má proto `dof` 12 místo 8. Sdílení přes veřejné API wrapperu nejde, potřebná funkce je `private`.
3. **Matematika B-spline pro `FakeKernel`.** `kernel` smí záviset jen na `core`, ale vyhodnocení splinu je podle spec v `sketch/bspline.ts`.

Ověřeno se skutečným planegcs 1.3.0: `point_on_bspline` s parametrem jako číslem je pevný (nepřidá stupeň volnosti) a drží fit bod při tažení. Vnitřní řídicí body jako body planegcs, které nejsou body skici, fungují a jdou přečíst.

## Možnosti a návrh

**1. Tečnost na konci:**
- a) **`point_on_line` druhého (u konce předposledního) řídicího bodu na úsečce.** U sevřeného (clamped) splinu je tečna na začátku úměrná `P1 − P0`. Když úsečka prochází koncem `P0` a `P1` na ní leží, je tečná. Je to jedna rovnice. U `fitSpline` jde o skrytý řídicí bod. Ověřeno u obou druhů.
  - \+ Přesné, jednoduché, bez odkazu na spline (nevzniknou fantomové parametry).
  - − Připouští i `P1` za koncem na druhé straně: přímka je tečná, jen spline odchází „proti“ úsečce. Stejně se chová tečnost úsečka–oblouk.
- b) Počkat na planegcs a tečnost na konci zatím vynechat.

**2. `dof` fit-splinu:**
- a) **Odečíst 4 za každý spline, na který odkazuje vazba planegcs.** Sloupce Jacobiánu těch parametrů jsou nulové, hodnost neovlivní. Izolované v jedné funkci adaptéru, test pohlídá změnu chování při upgradu planegcs.
- b) Vložit vlastní `make_bspline` se sdílenými adresami do cache wrapperu (obejít zapouzdření).
- c) Smířit se s `dof` = 2 · fit bodů + 4 (panel by u plně určené skici se splinem nikdy neukázal „Plně určeno“).

**Doplněk:** s 1a) nemá `bspline` (řídicí body jsou body skici) žádnou vazbu, která by na spline v planegcs odkazovala. Primitiv `bspline` tedy na řešení nemá vliv a nemusí se do systému vůbec přidávat: `bspline` = jen jeho body.

**3. Matematika B-spline:**
- a) **Přesunout `bspline.ts` do `core/math/`** (obecná matematika jako `plane`, `vec3`). `sketch` ji re-exportuje, `kernel` ji použije ve `FakeKernel`.
- b) Duplikovat malý de Boor (~40 řádků) ve `fake-kernel.ts`.

**4. Spline, který kříží sám sebe** (osmička; uzavřený spline a, b, a, který se vrací po sobě): krok 3 [[12-skicar#Oblasti (profily)|oblastí]] hledá křížení jen mezi dvojicí křivek, takže takový spline dnes dá nesmyslné stěny nebo smyčku s plochou ≈ 0.
- a) **Samokřížení = `crossing`:** nesousední úseky tessellace téhož splinu se nesmí protnout (kromě shodných konců uzavřeného splinu). Stejné pravidlo jako pro dvě křivky, jen uvnitř jedné.
- b) Neřešit, profil pak selže až v jádře.

**Návrh:** 1a, 2a s doplňkem (bez primitivu pro `bspline`), 3a, 4a.

## Rozhodnutí

**Bod 3** – Pavel 2026-10-15: „Přesunout do core/math“ (návrh 3a). Do `core` jen obecná matematika nad `Vec2` a čísly, bez typů skici. Propsáno do [[12-skicar#Spliny (M29)]] a [[02-core#Matematika (hodnotové typy)]].

**Body 1 a 2** – Pavel 2026-10-15: „Ano, 1a + 2a“. Tečnost úsečka–spline na konci = `point_on_line` druhého (u konce předposledního) řídicího bodu na úsečce, u `fitSpline` skrytý řídicí bod. Adaptér odečte 4 za každý spline, na který odkazuje vazba planegcs (jedna funkce s komentářem, test upozorní na změnu chování planegcs); `bspline` se do planegcs nepřidává, jen jeho body. Propsáno do [[12-skicar#Spliny (M29)]].

**Bod 4** – Pavel 2026-10-15: „Ano, crossing“ (návrh 4a). Samokřížení splinu = `crossing`: nesousední úseky tessellace téhož splinu se nesmí protnout (kromě shodných konců uzavřeného splinu). Propsáno do [[12-skicar#Spliny (M29)]].
