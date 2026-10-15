---
type: question
status: answered
area: "[[09-vykreslovani]]"
decide_by: "[[M24-realisticke-zobrazeni]]"
proposal: "Tone mapping jen pro model (vlastní průchod v pipeline, interakce v barvách palety); kontaktní stín jako v příkladu three (hloubka zespodu, rozmazání), přepočítaný jen při změně těles; sklo do AO nevstupuje."
decision: "Tone mapping v shaderu fyzikálních materiálů těles (onBeforeCompile), renderer bez tone mappingu; kontaktní stín jako webgl_shadow_contact přepočítaný jen při změně těles; sklo skryté v AO; gradient pozadí z palety (ADR 0027)."
tags:
  - otazka
created: 2026-10-15
updated: 2026-10-15
---
# Q082 Scéna režimu Realistic

**Oblast:** [[09-vykreslovani]], [[Styl zobrazení]] · **Rozhodnout do:** [[M24-realisticke-zobrazeni]]

## Otázka

Režim Realistic ([[M24-realisticke-zobrazeni|M24]]) nemění jen materiály těles, ale i scénu: environment mapu, tone mapping, kontaktní stín místo mřížky a pozadí. Pipeline z [[0026-viceprochodove-vykreslovani-ve-viewportu|ADR 0026]] přitom kreslí model a interakce v oddělených průchodech. Zbývá rozhodnout:

1. **Na co se vztahuje tone mapping?** Three ho při kreslení do render targetu v materiálech nedělá a v pipeline ho dělá až `OutputPass` nad celým obrazem. Tím by změnil i barvy interakcí: oranžový výběr, modré skici a manipulátory. Bez composeru se tone mapping řídí `renderer.toneMapping` a `material.toneMapped`.
2. **Jakou technikou kreslit kontaktní stín a kdy ho přepočítat?**
3. **Jak se sklo (`transmission`, pokud ho [[Q078 Sada materiálů těles|Q078]] schválí) chová k AO?** Sklo zapisuje hloubku, takže AO by pod ním kreslilo tmavé skvrny jako u průhlednosti v M22.

## Možnosti a návrh

**1. Tone mapping:**
- a) **Jen model.** Realistic kreslí vždy přes pipeline, i bez AO. Za AO přijde vlastní průchod tone mappingu na místě (ACES/AgX v lineárním prostoru, bez změny hloubky), pak interakce a `OutputPass` jen s převodem do sRGB.
  - \+ Výběr, skici a manipulátory mají ve všech režimech stejné barvy palety.
  - − Realistic bez AO stojí render target navíc.
- b) **Celý obraz** (`renderer.toneMapping` a `OutputPass`).
  - \+ Jednodušší.
  - − Barvy interakcí se v Realistic posunou a oranžová výběru nebude sedět s `--selection` v UI.
- c) **Bez composeru přes `material.toneMapped = false` u interakcí.**
  - − Funguje jen při kreslení na plátno. S AO to selže, takže by se Realistic a AO chovaly různě.

**2. Kontaktní stín:**
- i) **Jako příklad three `webgl_shadow_contact`:** ortografická kamera zespodu vykreslí hloubku těles do malého render targetu, ten se rozmaže a položí se jako průhledná rovina ve výšce spodku obálky.
  - \+ Na kameře nezávisí, takže se přepočítá jen po změně těles (`sync`, skrytí). Otáčení kamerou je zadarmo.
  - − Další render target a průchody, ale jen při změně modelu.
- ii) **Stínová mapa od směrového světla a `ShadowMaterial`:** ostrý stín závislý na světle.
  - − U CAD ruší a je třeba ladit bias.
- iii) **Rozmazaná elipsa podle obálky:**
  - \+ Levná.
  - − Nevypadá jako stín tvaru.

**3. Sklo a AO:** sklo se v průchodu AO skryje (jako `LineSegments2`), takže AO ho nevidí a nic pod ním neztmavuje. Kolem skla se tak AO nekreslí, což je přijatelné.

**Pozadí:** jemný svislý gradient z palety (dvě nové barvy `realisticBackground` pro světlé a tmavé téma), kreslený jako `scene.background` z malé textury. Environment mapa (`RoomEnvironment` přes `PMREMGenerator`) se kreslí jen jako osvětlení, ne jako pozadí.

**Návrh:** 1a + 2i + 3 + gradient. Rozhodnutí patří do ADR M24 vedle materiálu tělesa: scéna Realistic rozšiřuje pipeline z ADR 0026.

## Rozhodnutí

Pavel 2026-10-15 schválil návrh 1a + 2i + 3 + gradient. **Bod 1a se ale změnil** hned po schválení, protože se ukázalo, že nejde udělat:

- **Proč 1a nejde:** tone mapping na místě je nelineární křivka. Na rozdíl od násobení AO ji blending nevyjádří, takže by shader musel číst barvu z targetu, do kterého zároveň zapisuje (feedback loop, WebGL to zakazuje). S výměnou targetů by se ztratila hloubka modelu.
- **Pavel zvolil 1d:** tone mapping dělá shader fyzikálních materiálů těles sám. `onBeforeCompile` nahradí `#include <tonemapping_fragment>` voláním křivky AgX a vloží potřebné funkce. `renderer.toneMapping` zůstává `NoToneMapping`.
  - \+ Interakce zůstávají v barvách palety.
  - \+ Realistic bez AO kreslí bez composeru a nepotřebuje žádný průchod navíc.
  - − Kód závisí na shader chunku three, proto ho hlídá kanárkový test.
  - − AO násobí už tone-mapované barvy.
- Ostatní body: 2i (kontaktní stín přepočítaný jen při změně těles), 3 (sklo skryté v AO), gradient pozadí.

Zapsáno v [[0027-material-telesa-a-scena-realistic|ADR 0027]], propsáno do [[09-vykreslovani#Realistic]].
