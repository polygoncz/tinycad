---
type: insight
status: seed
aliases:
  - Výběr hran v obrazovce
topics:
  - vykreslování
  - interakce
  - geometrie
sources:
  - https://threejs.org/docs/#api/en/core/Raycaster
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# Picking hran v pixelech

**Shrnutí:** Hranu nejde trefit paprskem (nemá plochu), proto se vybírá podle vzdálenosti v pixelech na obrazovce a viditelnost se ověřuje zvlášť raycastem proti plochám.

## Podrobnosti

- **Postup:** segmenty hran promítnout do obrazovky, najít kandidáty do tolerance (~6 px) seřazené podle vzdálenosti, pro každého spočítat 3D bod a vystřelit paprsek proti plochám s `far` = hloubka bodu − tolerance. Když nic netrefí, je hrana viditelná a má přednost před plochou.
- **Tolerance zákrytu** je nutná, protože hrana leží na hranici ploch: raycast k ní trefí sousední plochu skoro ve stejné hloubce.
- **Krajní případy:** hrana viděná z čela (průmět je bod) má brát bližší konec ke kameře; segment přes `near`/`far` se nepromítá.
- **Ortografická kamera** to zjednodušuje: tolerance v pixelech znamená stejnou vzdálenost v celé scéně a parametr `t` z obrazovky platí i ve 3D.
- **Test:** projít `pick` po mřížce celé obrazovky a ověřit, že žádný výsledek neleží na skrytých hranách.
- Pro velké modely se místo toho používá GPU picking (ID objektu do offscreen bufferu).

## Jak to využívá tinycad

`picker.ts` a čisté funkce `closestSegments`, `projectSegments` ve [[09-vykreslovani#Picking|spec 09]], ověřeno skenem v [[M08-vykreslovani|M8]].

## Zdroje

- three.js: `Raycaster`
