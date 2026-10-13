---
type: question
status: answered
area: "[[09-vykreslovani]]"
decide_by: "[[M10-ui]]"
proposal: "render přijme paletu (ScenePalette) a metodu setPalette; ui ji sestaví z CSS proměnných a přepne při změně režimu."
decision: "Paleta ScenePalette jako vstup render, setPalette při přepnutí režimu; ui předá režim přes AppSession.setTheme."
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q072 Barvy scény podle režimu

**Oblast:** [[09-vykreslovani]], [[11-ui]] · **Rozhodnout do:** [[M10-ui]]

## Otázka

UI má světlý i tmavý režim (rozhodnutí 2026-10-13). Barvy ve [[Viewport|viewportu]] (pozadí, plochy a hrany těles, zvýraznění, osy) jsou dnes konstanty v `render` (`FACE_COLOR`, `EDGE_COLOR`, barvy v `highlight-layer`, `scene-helpers`). Three.js CSS proměnné nečte. Jak se scéna dozví, jaké barvy má použít?

## Možnosti a návrh

1. **Paleta jako vstup `render`.** Typ `ScenePalette` (barvy jako čísla), výchozí světlá a tmavá paleta v `render`. `createViewport` ji přijme a `setPalette` ji přepne (materiály se přebarví, nevytvoří znovu). `ui` vybere paletu podle režimu.
   - \+ `render` nezná DOM ani CSS, testuje se v Node. Jedna pravda o barvách scény.
   - − Barvy scény a barvy CSS jsou na dvou místech (paleta a CSS proměnné).
2. **`ui` čte CSS proměnné** (`getComputedStyle`) a převádí je na paletu.
   - \+ Jediný zdroj barev, CSS.
   - − Převod barev z CSS v `ui` a test jen v prohlížeči.
3. **Jen pozadí podle režimu**, tělesa stejná.
   - \+ Nejméně práce.
   - − Hrany a zvýraznění budou v jednom z režimů špatně čitelné.

Návrh: **1**. Paleta je hodnota, takže se dá snadno testovat i předat. Akcentní barva zvýraznění v paletě odpovídá `--accent` z CSS.

## Rozhodnutí

2026-10-13 (Pavel): **možnost 1.** `render` má typ `ScenePalette` a výchozí světlou a tmavou paletu, `Viewport.setPalette` přebarví materiály. `ui` předá režim přes `AppSession.setTheme` a `app` vybere paletu (`ui` nesmí importovat `render`). Propsáno do [[09-vykreslovani]] a [[11-ui]].
