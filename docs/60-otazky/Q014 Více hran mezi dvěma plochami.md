---
type: question
status: answered
area: "[[08-topologicke-pojmenovani]]"
decide_by: "[[M14-topologicke-pojmenovani]]"
proposal: "Řešit, až nastane"
decision: "edge:<A>|<B>; při shodě kontext ploch u koncových vrcholů [<C>,<D>], až pak #k podle středu hrany (ADR 0018)"
tags:
  - otazka
created: 2026-10-12
updated: 2026-10-14
---
# Q014 Více hran mezi dvěma plochami

**Oblast:** [[08-topologicke-pojmenovani]] · **Rozhodnout do:** [[M14-topologicke-pojmenovani]]

## Otázka

Jak pojmenovat hrany, když dvě plochy sdílí víc než jednu hranu (např. šev válce)?

## Možnosti a návrh

Pořadový index podle geometrického kritéria je křehký. Alternativa: hrana pojmenovaná i podle sousedních vrcholů. Souvisí s [[Topologické pojmenování]].

## Rozhodnutí

2026-10-14 (noční rychloakce, bez Pavla – [[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R95]] ⚠): **vrstvené rozlišení**, formát v [[0018-format-topologickych-jmen|ADR 0018]], pravidla v [[08-topologicke-pojmenovani#Hrany]].

1. Hrana se jmenuje podle primárních jmen dvou sousedních ploch `edge:<A>|<B>` (seřazená; šev pláště válce `edge:<A>|<A>`).
2. Sdílí-li stejnou dvojici víc hran, přidá se **kontext**: seřazená jména ploch, které se dotýkají koncových vrcholů hrany, bez A a B – `edge:<A>|<B>[<C>,<D>]`. To je varianta „podle sousedních vrcholů“ z návrhu, jen vrcholy nejmenujeme indexem, ale opět plochami, takže je stabilní stejně jako jména ploch.
3. Když ani kontext nerozliší (obě hrany mají stejné okolí, nebo jsou uzavřené bez dalších sousedů), dostanou `#1`, `#2`… podle středu hrany (lexikograficky x, y, z). To je ten křehký geometrický index – jen jako poslední záchrana, ve scénářích M14 nenastane.

Proč: pořadový index hned v prvním kroku by se přehodil při každé změně rozměru, kontext ploch ne. Kontext ani index nevyžadují historii hran, stačí `kernel.topology()`.
