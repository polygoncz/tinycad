---
type: question
status: answered
area: "[[05-persistence]]"
decide_by: "[[M15-export-a-dokonceni]]"
proposal: "Až bude regenerace pomalá"
decision: "persistentní cache geometrie nevzniká; render cachuje sítě podle handle, regenerace podle identity; měření M15 v dodatku"
tags:
  - otazka
created: 2026-10-12
updated: 2026-10-14
---
# Q007 Cache geometrie

**Oblast:** [[05-persistence]] · **Rozhodnout do:** [[M15-export-a-dokonceni]]

## Otázka

Ukládat cache geometrie (BREP přes `BinTools` nebo hotové sítě) pro rychlé otevření velkých dokumentů?

## Možnosti a návrh

Klíčovaná hashem receptu, při nesouladu se zahodí. Řešit, až bude regenerace při otevření pomalá. Souvisí s [[Q008 OPFS nebo IndexedDB]].

## Rozhodnutí

2026-10-14 (noční rychloakce, [[Rozhodnutí noční rychloakce#M15 – Export a dokončení|R131]] ⚠): **Persistentní cache geometrie ani nová cache sítí v M15 nevzniká.** Sítě už cachuje `render` podle handle (`MeshCache`, [[09-vykreslovani#Synchronizace s regenerací]]) a nezměněné těleso má po regeneraci tentýž handle (cache regenerace podle identity, [[07-regenerace#Cache podle identity]]), takže se znovu netesseluje. Cache v úložišti by zrychlila jen otevření dokumentu a potřebovala by serializaci BREP, klíč z receptu a zneplatnění – víc kódu než užitku u modelů tinycad. Rozhodnuto **před** měřením; měření v [[M15-export-a-dokonceni#Ú6 `tests`: měření výkonu|M15 Ú6]] zapíše hlavní sezení jako dodatek níže. Pokud by první regenerace modelu z měření (~40 featur) trvala déle než 2 s, rozhodnutí se přehodnotí a nápad dostane čísla v [[M15-export-a-dokonceni#Další nápady (mimo rozsah)|Další nápady]]. Propsáno do [[05-persistence#Co se ukládá]] (beze změny: geometrie se neukládá).

> [!note] Měření M15
> _(doplní hlavní sezení po Ú6: medián první regenerace, tessellace, plného přepočtu a přepočtu z cache.)_
