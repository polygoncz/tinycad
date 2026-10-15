---
type: insight
status: seed
aliases:
  - Siluety zakřivených ploch
  - Silhouette edges
topics:
  - vykreslování
  - B-rep
sources:
  - https://dev.opencascade.org/doc/overview/html/occt_user_guides__modeling_algos.html#occt_modalg_10
  - https://en.wikipedia.org/wiki/Silhouette_edge
tags:
  - poznatek
created: 2026-10-15
updated: 2026-10-15
---
# Silueta není hrana

**Shrnutí:** Hrany B-rep jsou topologie a na pohledu nezávisí. Obrys zakřivené plochy (silueta) je naopak vlastnost pohledu, a proto ho samotné kreslení hran nikdy neukáže.

## Podrobnosti

- Válec má v B-rep jen horní a dolní kružnici a šev. Jeho boční obrys je místo, kde normála plochy stojí kolmo na směr pohledu, a s každým otočením kamery se posouvá.
- Čárové režimy, které kreslí jen hrany B-rep (drátový model, skryté hrany přes hloubkový buffer), proto zakřiveným tělesům obrys nedají. Kvádr vypadá správně, válec „bez boků“.
- Řešení:
  - **Na síti:** hrana trojúhelníků je siluetová, když jeden sousední trojúhelník míří ke kameře a druhý od ní. Počítá se při každé změně pohledu (CPU nebo geometry shader).
  - **V jádře:** HLR (hidden line removal) v OCCT (`HLRBRep_Algo`, rychlejší `HLRBRep_PolyAlgo` nad triangulací) vrátí viditelné a skryté hrany včetně obrysů pro daný směr pohledu. Je přesné, ale pomalé na interaktivní otáčení. Hodí se pro výkresy.
- Onshape a další CAD siluety v čárových režimech dopočítávají. Je to znatelný rozdíl v čitelnosti zakřivených dílů.

## Jak to využívá tinycad

V [[M22-rezimy-zobrazeni|M22]] se siluety nekreslí a ve [[09-vykreslovani#Styl zobrazení]] jsou vedené jako známé omezení. Viditelnost hran řeší [[Viditelnost přes hloubkový buffer]].

## Zdroje

- OCCT, Modeling Algorithms: Hidden Line Removal
- Wikipedia: Silhouette edge
