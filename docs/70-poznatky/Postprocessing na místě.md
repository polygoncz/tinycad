---
type: insight
status: seed
aliases:
  - In-place postprocessing
  - needsSwap false
topics:
  - vykreslování
  - Three.js
sources:
  - node_modules/three/examples/jsm/postprocessing/EffectComposer.js (three 0.186)
  - node_modules/three/examples/jsm/postprocessing/GTAOPass.js (three 0.186)
  - https://threejs.org/docs/#examples/en/postprocessing/EffectComposer
tags:
  - poznatek
created: 2026-10-15
updated: 2026-10-15
---
# Postprocessing na místě

**Shrnutí:** Když průchod po efektu potřebuje hloubku scény, nestřídej buffery (ping-pong). Všechny průchody ať kreslí do jednoho render targetu a efekt se do barvy přimíchá blendingem.

## Podrobnosti

- **Ping-pong:** `EffectComposer` má dva render targety. Průchod čte `readBuffer` a píše do `writeBuffer`, pak se prohodí (`needsSwap`). Barva se tak přenáší, hloubka ne. Každý target má vlastní hloubkový buffer a celoobrazovkový průchod do něj nic nezapíše.
- **Na místě:**
  - Průchod s `needsSwap = false` kreslí zpět do `readBuffer`. `RenderPass` to tak dělá sám.
  - Efekt, který jen mění barvu (AO, vinětace, barevná korekce), se nakreslí celoobrazovkovým čtyřúhelníkem s blendingem (např. násobení `DstColorFactor`/`ZeroFactor`) a bez testu i zápisu hloubky.
  - Hloubka z prvního průchodu tak zůstane pro další `RenderPass` s `clear: false`.
- **Bonus:** druhý target composeru se pak nikdy nepoužije a three ho na GPU nealokuje.
- **Proč ne kreslit „po composeru“ přímo na plátno:** výstupní průchod zapíše na plátno jen barvu, hloubka plátna zůstane prázdná a objekty za modelem by prosvítaly.
- **Nástraha:** knihovní průchody počítají s ping-pongem. `GTAOPass` s výstupem `Off` nic nekreslí, takže se dá použít jen na výpočet textury efektu a smíchání si napsat sám.

## Jak to využívá tinycad

Pipeline AO: model → AO vynásobené na místě → interakce bez mazání hloubky → `OutputPass` ([[0026-viceprochodove-vykreslovani-ve-viewportu|ADR 0026]]). Skici a mřížka za tělesem tak zůstávají zakryté i s AO. Navazuje na [[MSAA v render targetu]] a [[Viditelnost přes hloubkový buffer]], rozdělení scény na průchody popisuje [[Průchody podle viditelnosti skupin]].

## Zdroje

- Zdrojáky `EffectComposer` a `GTAOPass` (three 0.186)
- Dokumentace three.js: `EffectComposer`
