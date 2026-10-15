---
type: insight
status: seed
aliases:
  - Object3D.layers vs visible
  - Rozdělení scény na průchody
topics:
  - vykreslování
  - Three.js
sources:
  - https://threejs.org/docs/#api/en/core/Layers
  - https://threejs.org/docs/#api/en/core/Raycaster.layers
  - node_modules/three/examples/jsm/postprocessing/GTAOPass.js (_overrideVisibility, three 0.186)
tags:
  - poznatek
created: 2026-10-15
updated: 2026-10-15
---
# Průchody podle viditelnosti skupin

**Shrnutí:** Když se jedna scéna Three.js kreslí po částech v několika průchodech, je bezpečnější na dobu průchodu přepnout `visible` u kořenových skupin a v `finally` ho vrátit, než použít `Object3D.layers`.

## Podrobnosti

- **Vrstvy se nedědí:** `layers` testuje renderer u každého objektu zvlášť. Maska rodiče na potomky nepůsobí, takže by ji musel dostat každý objekt, včetně těch, které vzniknou později (zvýraznění, kresby skic).
- **`Raycaster` testuje vrstvy taky:** výchozí raycaster vidí jen vrstvu 0. Objekt přesunutý jen do vrstvy 1 přestane jít vybrat a chyba se projeví daleko od místa, kde vznikla.
- **Viditelnost se dědí:** skrytá skupina skryje celý podstrom jedním řádkem. Stačí znát pár kořenů a zbytek (nové vrstvy, potomci) se zařadí sám.
- **Obnova původní hodnoty:** uložit `visible` před skrytím a obnovit ho, ne nastavit `true`. Objekt skrytý z jiného důvodu (uživatel skryl těleso) musí zůstat skrytý. U duplicit v seznamu uložit hodnotu jen při prvním výskytu. Obnovu dát do `finally`, aby výjimka v průchodu nenechala scénu rozbitou.
- **Mimo snímek nic nezůstane:** picking, obálka scény i logika vrstev vidí scénu nezměněnou.
- Stejný vzor používá `GTAOPass`, který tak skrývá čáry v G-bufferu. Kontroluje ale jen některé typy (ne `LineSegments2`), takže obal musí skrýt i to, co knihovna vynechá.

## Jak to využívá tinycad

`scene-partition.ts` (`partitionScene`, `hideDuring`, `aoExcluded`) v pipeline AO, [[09-vykreslovani#Víceprůchodové vykreslování (AO)]] a [[0026-viceprochodove-vykreslovani-ve-viewportu|ADR 0026]]. Navazuje na [[Postprocessing na místě]].

## Zdroje

- three.js: `Layers`, `Raycaster.layers`
- Zdrojáky `GTAOPass` (`_overrideVisibility`, three 0.186)
