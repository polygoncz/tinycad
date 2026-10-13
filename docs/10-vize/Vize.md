---
type: moc
status: active
aliases:
  - Vize a rozsah
tags:
  - vize
created: 2026-10-12
updated: 2026-10-12
---
# Vize a rozsah

> **Související:** [[Domů]], [[01-architektura|Architektura]], [[Roadmapa]]

## Proč

tinycad je osobní výukový projekt. Chci si v praxi vyzkoušet:

- návrh větší aplikace s čistou vrstvenou architekturou a dobrým objektovým návrhem,
- webovou 3D grafiku (Three.js, WebGL),
- provoz B-rep jádra (OpenCascade) v prohlížeči přes WebAssembly a Web Workery,
- parametrické modelování s historií (strom featur, regenerace, rollback),
- operační log (event sourcing) jako základ undo/redo a ukládání,
- topological naming problem – jak stabilně odkazovat na geometrii, která se při každé regeneraci vytváří znovu.

## Co stavíme

Aplikaci podobnou Onshape **Part Studiu**: jeden dokument, v něm seřazený seznam featur, z nichž se přehráním vytvoří tělesa. Uživatel featury přidává nástroji, upravuje jejich parametry v dialogu a vidí výsledek ve 3D.

### Cílový rozsah (v pořadí, jak přibývá)

1. Kvádr (Box) – první a dlouho jediná entita, na které ověříme celou architekturu.
2. Válec, Transformace, Boolean (sjednocení, rozdíl, průnik).
3. Skicář: úsečky, oblouky, kružnice, vazby a kóty.
4. Extrude a Revolve ze skici.
5. Fillet a Chamfer na hranách, skica na ploše tělesa (vyžaduje topologické pojmenování).
6. Export do STEP.

### Princip rozšiřitelnosti

Přidání nového typu featury nebo nástroje = **nový modul ve `src/features/<nazev>/` a jeden řádek registrace**. Pokud kvůli nové entitě musíme měnit kód jinde, je to signál, že architektura někde netěsní, a opravíme ji.

## Co nestavíme (non-goals)

- Sestavy (assemblies), výkresy, kusovníky.
- Více uživatelů současně, sdílení, cloud. (Operační log je ale navržený tak, aby to šlo později doplnit.)
- Backend. Vše běží v prohlížeči. Server může přijít později jako alternativní adaptér jádra nebo persistence.
- Proměnné a výrazy v parametrech (`#delka * 2`). Možná později, viz otevřené otázky v [[03-dokument|dokumentu]].
- Mobilní ovládání.
- Dokonalost: rozumná robustnost stačí, cílem je pochopení.

## Kritéria úspěchu

- Celá cesta *klik → operace → log → regenerace ve workeru → vykreslení → undo* funguje a je pokrytá testy.
- Přidání válce po kvádru nevyžaduje změnu kódu mimo `src/features/cylinder/` a registraci.
- Dokument přežije zavření prohlížeče a po otevření jde dál vracet změny (undo).
- Fillet na hraně přežije změnu rozměru kvádru, pod kterým leží.
