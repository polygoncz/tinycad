---
type: question
status: answered
area: "[[13-testovani]]"
decide_by: "[[M38-zmrazeni-domeny]]"
proposal: "Jména ploch a hran porovnávat přesně, indexy vůbec; plochu v případu identifikovat jménem a geometrickým podpisem (typ, normála, plocha)."
decision: "Jména přesně, indexy podtvarů se neporovnávají; plocha se v případu popíše jménem, typem plochy a rovinou, hrana jménem a středem."
tags:
  - otazka
created: 2026-10-17
updated: 2026-10-17
---
# Q108 Plochy a hrany ve sdílených případech

**Oblast:** [[13-testovani]], [[08-topologicke-pojmenovani]], [[0018-format-topologickych-jmen|ADR 0018]] · **Rozhodnout do:** [[M38-zmrazeni-domeny|M38]]

## Otázka

Případy regenerace ze [[Sdílený testovací případ|sdílených případů]] zaznamenají tělesa z OCCT ve WASM (řada 7.x), C++ jádro je bude ověřovat proti OCCT 8.0.1. Pořadí podtvarů (index plochy a hrany v `TopExp::MapShapes`) se mezi verzemi může lišit. Co v případu porovnávat?

## Možnosti a návrh

**A. Jména přesně, indexy vůbec (návrh).** Každá plocha a hrana tělesa se v případu zapíše jako jméno (nebo `''`) a geometrický podpis (typ plochy, normála u roviny, plocha, obálka), seřazené podle jména a podpisu.
- \+ Jména se ukládají v dokumentech jako reference ([[Topologické pojmenování]]), takže se musí shodovat přesně. Podle [[0018-format-topologickych-jmen|ADR 0018]] na indexech nezávisí.
- \+ Rozdíl v pořadí podtvarů mezi verzemi OCCT případ neshodí.
- − Jména závisí na historii OCCT (`generated`, `modified`). Když ji OCCT 8 hlásí jinak, případ padne. To je ale skutečný nález, ne šum.

**B. Porovnávat i indexy.**
- − Shodí případ kvůli vnitřnímu pořadí OCCT, které klient nikdy nevidí přímo (jméno je na indexu `i + 1` jen v read modelu).

**C. Jen počty ploch a hran.**
- − Neprokáže topologické pojmenování, které je nejcitlivější část přepisu.

## Rozhodnutí

**Varianta A (Pavel 2026-10-17, podle návrhu Clauda).**

Upřesnění při psaní kontraktu: port `GeometryKernel` v TS obsah plochy nezná (`topology()` vrací jen `surface` a `plane`), proto je podpis plochy **typ plochy a rovina** (normála a vzdálenost, jen u roviny) a podpis hrany **střed** (`midpoint`). Objem tělesa viz [[Q110 Tolerance sdílených případů|Q110]]. Propsáno do [[13-testovani#Sdílené testovací případy]].
