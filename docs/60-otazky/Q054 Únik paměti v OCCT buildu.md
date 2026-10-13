---
type: question
status: answered
area: "[[06-geometricke-jadro]]"
decide_by: "[[M07-kernel-occt]]"
proposal: "Známé omezení buildu; kritérium M7 přeformulovat, paměť řešit v M16"
decision: "známé omezení buildu; kritérium M7 přeformulováno, paměť řeší M16"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q054 Únik paměti v OCCT buildu

**Oblast:** [[06-geometricke-jadro]] · **Rozhodnout do:** [[M07-kernel-occt]]

## Otázka

Při práci na [[Q053 Citlivost paměťového testu OCCT|Q053]] se ukázalo, že paměť ztrácí **samo OCCT**, ne adaptér. Holé `BRepPrimAPI_MakeBox` + `Shape()` + `delete()` všech objektů nechá v haldě ~11 kB na kvádr, s `BRepMesh` ~18 kB. Celé kolo adaptéru (`makeBox` + `tessellate` + `release`) ~27 kB. Stejně se chová `replicad-opencascadejs` 1.1.0 i `opencascade.js` 2.0 beta (20 000 kvádrů: 100 → 239 MB, resp. 100 → 207 MB). `MakeVertex` nic neztrácí. Refcount triangulace plochy po smazání všech JS kopií tvaru neklesne, takže topologie (`TShape`) zůstane viset. Úmyslný únik v adaptéru (neuvolněný `Node(i)`, `release` bez mazání) proto nejde odlišit. Záznam ve spiku ([[0013-replicad-opencascadejs|ADR 0013]]: „s `.delete()` konstantní“) byl chybný – 3000 kol se vešlo do počáteční rezervy.

Možná příčina: OCCT u tvarů z `BRepPrim`/sweepů drží vzájemné odkazy, které se při zničení neuvolní (zmínky v trackeru OCCT); nebo vazby embind. Nezjištěno.

Dopad: ~27 kB na kvádr a regeneraci. Tisíc regenerací modelu s deseti tělesy ≈ 270 MB, tedy v delší relaci znatelné.

## Možnosti a návrh

| Varianta | Pro | Proti |
|---|---|---|
| **A: známé omezení buildu.** Kritérium M7 přeformulovat na „adaptér uvolní všechny objekty OCCT, které vlastní“ (ověří revize a `using`), paměťový test odstranit (nic neověřuje). Únik zapsat do ADR 0013 jako důsledek. Hledání příčiny a měření paměti → [[M16-vlastni-occt-build]] (v C++ s nástroji na úniky). | M7 nebrzdí, poctivé | únik zůstává; kritérium jen revizí |
| B: hledat příčinu teď (časově omezeno, ~1 večer): rozložit `MakeBox` na `BRepBuilderAPI_*`, zkusit `BRepTools::Clean`, hledat v issue trackeru replicad | můžeme najít obejití | bez C++ a sanitizerů se hledá naslepo, nejistý výsledek |
| C: obejití za portem: restart workeru jádra po překročení paměti (regen už umí `'disconnected'` – [[Q049 Pád jádra během regenerace\|Q049]]) | únik neomezuje délku relace | nový mechanismus, patří spíš do M10 a později |

Návrh: **A**, a C zapsat jako nápad do [[M16-vlastni-occt-build]] (pokud M16 únik neodstraní). Pro výukový projekt s malými modely únik v M7–M15 nevadí.

## Rozhodnutí

2026-10-13: **Varianta A.** Únik je známé omezení buildu, zapsané v [[0013-replicad-opencascadejs|ADR 0013]] (dodatek). Kritérium [[M07-kernel-occt]] zní „adaptér uvolní všechny objekty OCCT, které vlastní“ a ověří ho revize a disciplína `using`; paměťový test se odstraňuje, nic neověřoval. Hledání příčiny, paměťový test a případný restart workeru jsou v [[M16-vlastni-occt-build]]. Propsáno do [[06-geometricke-jadro#Testy|spec 06]].
