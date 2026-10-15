---
type: insight
status: seed
aliases:
  - Hidden lines přes depth buffer
  - depthFunc GreaterDepth
topics:
  - vykreslování
  - WebGL
sources:
  - https://threejs.org/docs/#api/en/materials/Material.depthFunc
  - https://threejs.org/docs/#api/en/materials/Material.colorWrite
  - https://threejs.org/docs/#api/en/materials/Material.polygonOffset
tags:
  - poznatek
created: 2026-10-15
updated: 2026-10-15
---
# Viditelnost přes hloubkový buffer

**Shrnutí:** Čárové režimy CAD (skryté hrany, drátový model) jdou nakreslit bez geometrického výpočtu viditelnosti. Stačí nastavit, jak materiály čtou a zapisují hloubkový buffer.

## Podrobnosti

- **Bez skrytých hran:** plochy se kreslí v barvě pozadí a zapisují hloubku. Hrany za nimi neprojdou běžným testem hloubky.
- **Se skrytými hranami:** tytéž hrany (sdílená geometrie) se kreslí podruhé s `depthFunc: GreaterDepth` a čárkovaně. Projdou jen tam, kde už v bufferu leží bližší plocha, tedy právě skryté úseky. `renderOrder` musí zajistit, že plochy jsou v bufferu dřív.
- **Drátový model:** plochy mají `colorWrite: false` a `depthWrite: false`. Nic nekreslí, ale objekt zůstává `visible`, takže ho dál zasahuje raycast (plochy jdou vybrat) a nemění se obálka scény.
- **Hrana na vlastní ploše:** hrana leží ve stejné hloubce jako plocha, takže by se s ní „prala“ (z-fighting). `polygonOffset` posune plochy o kousek dál a hrana na ploše vyhraje. Díky tomu ji druhý průchod s `GreaterDepth` nepočítá jako skrytou.
- **Průhlednost:** plochy s `depthWrite: false` hloubku nezapisují, takže hrany za nimi jsou vidět bez druhého průchodu. Řadí se ale po objektech, ne po trojúhelnících, proto se vnitřní stěny konkávních těles mohou prolnout špatně (order-independent transparency je samostatné téma).

## Jak to využívá tinycad

Materiály `facesFlat`, `facesHidden` a `hiddenEdges` v `BodyMaterials` ([[09-vykreslovani#Styl zobrazení]], [[M22-rezimy-zobrazeni|M22]]). Rozhodnutí, který materiál kdy platí, dělá jen čistá `resolveDisplay` ([[Styl zobrazení]]). Co tahle technika neumí, popisuje [[Silueta není hrana]].

## Zdroje

- three.js dokumentace: `Material.depthFunc`, `Material.colorWrite`, `Material.polygonOffset`
