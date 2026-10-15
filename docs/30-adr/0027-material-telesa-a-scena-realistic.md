---
type: adr
status: accepted
number: 27
aliases:
  - ADR 0027
  - Materiál tělesa a scéna Realistic
date: 2026-10-15
related:
  - "[[03-dokument]]"
  - "[[04-operace-a-historie]]"
  - "[[09-vykreslovani]]"
  - "[[Q078 Sada materiálů těles]]"
  - "[[Q082 Scéna režimu Realistic]]"
  - "[[0026-viceprochodove-vykreslovani-ve-viewportu]]"
  - "[[M24-realisticke-zobrazeni]]"
supersedes:
tags:
  - adr
created: 2026-10-15
updated: 2026-10-15
---
# 0027 – Materiál tělesa a scéna Realistic

- **Stav:** Přijato (`status: accepted`, Pavel 2026-10-15)
- **Datum:** 2026-10-15
- **Souvisí:** [[Q078 Sada materiálů těles|Q078]], [[Q082 Scéna režimu Realistic|Q082]], [[0026-viceprochodove-vykreslovani-ve-viewportu|ADR 0026]], [[09-vykreslovani#Realistic]], [[M24-realisticke-zobrazeni|M24]]

## Kontext

[[Styl zobrazení]] dostává režim Realistic: fyzikálně založené materiály (PBR), osvětlení z environment mapy, tone mapping a kontaktní stín. Musíme rozhodnout dvě věci:

1. **Co o materiálu ví dokument.** [[Těleso]] už má v dokumentu barvu (M15, [[Q073 Průhlednost a barva těles|Q073]]). Materiál je další vlastnost vzhledu, která má přežít reload a jít přes undo.
2. **Jak se Realistic vejde do vykreslování.** To dnes umí jeden průchod nebo pipeline AO ([[0026-viceprochodove-vykreslovani-ve-viewportu|ADR 0026]]). Omezení:
   - Three dělá tone mapping v shaderu materiálu jen při kreslení na plátno. Při kreslení do render targetu ho nechává na `OutputPass`, a ten by v pipeline AO změnil celý obraz včetně barev výběru, skic a manipulátorů.
   - Tone mapping nejde udělat průchodem na místě. Je to nelineární křivka, blending ji nevyjádří a shader nesmí číst target, do kterého zapisuje.
   - Výměna targetů by ztratila hloubku modelu, kterou potřebují interakce (ADR 0026).
   - `GTAOPass` kreslí do G-bufferu každý viditelný `Mesh`, takže by tam bylo i sklo a průhledná rovina stínu.

## Rozhodnutí

**Dokument** ([[Q078 Sada materiálů těles|Q078]]):

1. **Materiál je identifikátor předvolby**, ne parametry rendereru:
   - `BodyMaterial = 'plastic' | 'aluminium' | 'steel' | 'brass' | 'glass' | 'rubber'`;
   - `BodyMeta.material` chybí = výchozí (plast);
   - operace `body.setMaterial(body, material)` po vzoru `body.setColor`. Upřesnění při implementaci (revize M24): bez `null`, výchozí hodnota je `DEFAULT_BODY_MATERIAL` (`'plastic'`) a kanonizace ji v dokumentu neukládá ([[04-operace-a-historie#Sada operací]]).

   Výčet a validaci vlastní `document`, `render` dostane typ přes `interaction` (jako `BodyId`).
2. **Parametry PBR zná jen `render`:** čistá tabulka `MATERIAL_PRESETS` (`metalness`, `roughness`, `clearcoat`, `transmission`, `ior`, `thickness`, výchozí barva). Změna parametrů ani nová předvolba nepotřebují migraci dokumentu.
3. **Barva tónuje předvolbu:** barva tělesa nahradí výchozí barvu předvolby a ostatní parametry zůstanou (modrý hliník = eloxovaný hliník). Plast bez barvy má barvu ploch z palety.
4. **Materiál platí jen v Realistic.** V ostatních režimech se kreslí jako dnes a materiál se drží jako barva v čárových režimech.

**Vykreslování** ([[Q082 Scéna režimu Realistic|Q082]]):

5. **Plán** dostane `faces: 'physical'` a `scene: 'studio' | 'realistic'`. `resolveDisplay` je dál jediné místo, kde se rozhoduje podle režimu.
6. **Tone mapping v shaderu materiálů těles:**
   - Fyzikální materiály si křivku AgX aplikují samy: `onBeforeCompile` nahradí `#include <tonemapping_fragment>` a vloží `tonemapping_pars_fragment`.
   - `renderer.toneMapping` zůstává `NoToneMapping`, takže interakce mají v každém režimu barvy palety.
   - Funguje stejně na plátně i v render targetu, s AO i bez něj.
7. **Environment mapa:**
   - `RoomEnvironment` přes `PMREMGenerator`, generovaná v kódu, nic se nestahuje.
   - Patří k připojenému rendereru jako pipeline AO: vzniká líně a uvolní se při `unmount`.
   - Dostává ji jen `envMap` fyzikálních materiálů, ne `scene.environment`, takže náhled a interakce se nemění.
8. **Kontaktní stín:**
   - Postup jako v příkladu three `webgl_shadow_contact`: ortografická kamera zespodu vykreslí hloubku viditelných těles hlavní vrstvy do malého render targetu, ten se rozmaže a položí jako průhledná rovina ve výšce spodku jejich obálky.
   - Přepočítá se **jen při změně těles** (sync, skrytí, změna barvy nebo materiálu nemá vliv), ne při pohybu kamery.
   - Rovina je přímý potomek scény, takže v pipeline AO patří mezi interakce a do G-bufferu nevstupuje.
9. **Pozadí a mřížka:** v Realistic je mřížka skrytá a pozadí je svislý gradient ze dvou barev palety (`DataTexture` 1 × 2, bez DOM).
10. **Sklo a AO:** obal `GTAOPass` v G-bufferu skryje kromě `LineSegments2` i meshe s `transmission > 0` (`aoExcluded`).

## Zvažované alternativy

- **Parametry PBR v dokumentu:**
  - Dokument by nesl detaily rendereru.
  - Každá změna materiálového modelu by znamenala migraci.
  - Uživatel CAD chce „hliník“, ne `roughness 0,35`.
- **Materiál přebíjí barvu:**
  - Barva by v Realistic nic neznamenala.
  - Eloxované a lakované díly by nešly.
- **Tone mapping celého obrazu** (`OutputPass`, `renderer.toneMapping`): posune barvy výběru, skic a manipulátorů, takže oranžová výběru v Realistic nesedí s `--selection` v UI.
- **Tone mapping výměnou targetů a druhým průchodem hloubky:** model by se kreslil o jednou víc a Realistic by vždy potřeboval composer.
- **`scene.environment`:** osvítí každý `MeshStandardMaterial` ve scéně, tedy i náhled editované featury. Rozhodnutí 7 je přesnější.
- **Stínová mapa směrového světla (`ShadowMaterial`):**
  - Ostrý stín závislý na světle u CAD ruší.
  - Ladí se bias.
  - Přepočítává se s kamerou, protože headlight je potomek kamery.
- **Rozmazaná elipsa podle obálky:** levná, ale nevypadá jako stín tvaru.

## Důsledky

- \+ Dokument zůstává malý a stabilní. Předvolby a jejich vzhled se ladí jen v `render`.
- \+ Realistic bez AO stojí jen fyzikální materiály a environment mapu. Stín se platí jen při změně těles.
- \+ Interakce mají ve všech režimech stejné barvy a výběr sedí s UI.
- − Tone mapping závisí na shader chunku three (`tonemapping_fragment`, `tonemapping_pars_fragment`, funkce `AgXToneMapping`). Kanárkový test hlídá, že chunk ve fyzikálním shaderu existuje. Při povýšení three se to musí zkontrolovat.
- − AO násobí už tone-mapované barvy, fyzikálně by mělo před tone mappingem. Vizuálně je to přijatelné, posoudí se při ručním ověření.
- − Sklo (`transmission`) přidává vnitřní průchod three s neprůhlednými objekty. Interakce v něm v jednoprůchodové cestě lámou světlo jako ostatní objekty, s AO ne. Je to drobná nekonzistence.
- − Kolem skla se AO nekreslí.
