---
type: adr
status: accepted
number: 18
aliases:
  - ADR 0018
  - Formát topologických jmen
date: 2026-10-14
related:
  - "[[08-topologicke-pojmenovani]]"
  - "[[0007-vlastni-topologicke-pojmenovani]]"
  - "[[0015-artefakty-a-identita-telesa]]"
  - "[[Q014 Více hran mezi dvěma plochami]]"
  - "[[Q015 Rozdělená plocha a reference]]"
supersedes:
tags:
  - adr
created: 2026-10-14
updated: 2026-10-14
---
# 0018 – Formát topologických jmen

- **Stav:** Přijato (`status: accepted`, noční rychloakce – rozhodnuto bez Pavla, [[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R94]])
- **Datum:** 2026-10-14
- **Souvisí:** [[08-topologicke-pojmenovani]], [[0007-vlastni-topologicke-pojmenovani|ADR 0007]], [[0015-artefakty-a-identita-telesa|ADR 0015]], [[Q014 Více hran mezi dvěma plochami|Q014]], [[Q015 Rozdělená plocha a reference|Q015]]

## Kontext

[[0007-vlastni-topologicke-pojmenovani|ADR 0007]] rozhodl, že [[Topologické pojmenování|topologická jména]] si píšeme sami. Jméno ale není jen vnitřní věc regenerace: `TopoRef.name` se **ukládá do dokumentu** (parametry Filletu, rovina skici, „Po plochu“). Změna formátu po M14 by rozbila uložené dokumenty a vyžádala migraci dat featur. Proto je formát datový kontrakt a patří do ADR, ne jen do specifikace.

Otázky, které formát musí zodpovědět: jak se jmenuje plocha z primitiva a z featury ze skici, jak plocha, která vznikla z hrany (zaoblení), jak hrana, když dvě plochy sdílí víc hran ([[Q014 Více hran mezi dvěma plochami|Q014]]), a co s jménem, které po operaci ukazuje na víc ploch ([[Q015 Rozdělená plocha a reference|Q015]]).

## Rozhodnutí

1. **Jméno je neprůhledný řetězec.** Porovnává se, ukládá a zobrazuje v ladění, ale **nikdy se nerozebírá** – ani v grafu závislostí, ani v UI. Razí ho jediné místo, `propagateNames` v `regen` ([[08-topologicke-pojmenovani#Tabulka jmen a přenos]]). Řetězce se řadí výchozím `sort()` (kódové jednotky UTF-16), ne podle jazyka.
2. **Plocha** vytvořená featurou podle role: `<featureId>/face:<role>`. Role vrací jádro (`ShapeResult.roles`): kvádr `top | bottom | front | back | left | right` podle **světových os** (+Z, −Z, −Y, +Y, −X, +X), válec `top | bottom | side`, vysunutí a rotace `start | end | side:<id entity skici>`.
3. **Plocha vzniklá z jiného podtvaru** (`generated`) bez role: `<featureId>/face:<tag>:<jméno zdroje>`, `tag` podle featury (`fillet`, `chamfer`, jinak `gen`). Zdrojem je plocha, hrana nebo vrchol vstupu; jméno se tak skládá rekurzivně (`f9/face:fillet:edge:f1/face:front|f1/face:top`).
4. **Upravená plocha** (`modified`, i identita) dědí všechna jména vstupní plochy. Plocha může mít víc jmen (sloučení) a jméno může ukazovat na víc ploch (rozdělení, Q015).
5. **Hrana** podle primárních jmen dvou sousedních ploch: `edge:<A>|<B>` (A < B; šev `edge:<A>|<A>`). Když stejnou dvojici sdílí víc hran (Q014), přidá se kontext ploch u koncových vrcholů `edge:<A>|<B>[<C>,<D>]` a teprve když ani to nestačí, pořadí `#<k>` podle středu hrany.
6. **Vrchol** podle všech sousedních ploch `vertex:<A>|<B>|<C>…` – jen jako zdroj pro pravidlo 3, reference na vrchol zatím nejsou.
7. Plocha, které žádné pravidlo jméno nedá, **zůstane bez jména** – nedostane náhradní jméno podle indexu.

## Zvažované alternativy

- **Jména z OCCT** (`BRepPrimAPI_MakeBox::FrontFace`, která je XMax) – svázala by uložená data s pojmenováním jádra a nesouhlasila by s přední rovinou XZ (normála −Y). Zamítnuto, role jsou podle světových os.
- **Hrana podle pořadového indexu mezi plochami** (návrh v Q014) – křehké už při změně rozměru; index zůstává jen jako poslední záchrana.
- **Hrany sledované historií zvlášť** – dvojnásobek dat v historii a další pravidla pro rozdělení hran; jméno z ploch stačí a vyjde samo.
- **Strukturovaná jména (objekt místo řetězce)** – snazší rozbor, ale rozbor nechceme (pravidlo 1) a řetězec se ukládá i čte nejjednodušeji.
- **Náhradní jméno podle indexu pro plochu bez jména** – nestabilní, po regeneraci by tiše ukázalo na jinou plochu, což ADR 0007 zakazuje.

## Důsledky

- \+ Jména jsou čitelná v ladicím panelu i v uloženém JSON a přežijí změnu rozměrů, protože vychází ze sémantiky featur a historie, ne z pořadí.
- \+ Hrany nepotřebují vlastní historii; stačí historie ploch a topologie sousednosti (`kernel.topology`).
- − Jména featur, které nesou jména jiných featur (díra z válce v kvádru), nevytvoří závislost na té featuře ([[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R110]] ⚠).
- − Jména zaoblení jsou dlouhá (vnořená); u řetězce zaoblení na zaoblení rostou lineárně s hloubkou.
- − Pořadí `#k` u hran je geometrické, a tedy křehké; nastává jen ve vzácném případě, kdy ani kontext vrcholů hrany nerozliší.
- − Změna formátu po M14 = migrace dat featur (`typeVersion`, [[03-dokument#Migrace dat featur]]).
