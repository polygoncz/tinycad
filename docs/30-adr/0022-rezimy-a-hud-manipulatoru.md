---
type: adr
status: accepted
number: 22
aliases:
  - ADR 0022
  - Režimy a HUD manipulátoru
date: 2026-10-14
related:
  - "[[0021-manipulatory-kotvy-z-regenerace]]"
  - "[[0010-prezentacni-model]]"
  - "[[09-vykreslovani]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
  - "[[M19-manipulator-fusion]]"
supersedes:
tags:
  - adr
created: 2026-10-14
updated: 2026-10-14
---
# 0022 – Režimy a HUD manipulátoru

- **Stav:** Přijato (`status: accepted`, Pavel 2026-10-14)
- **Datum:** 2026-10-14
- **Souvisí:** [[0021-manipulatory-kotvy-z-regenerace|ADR 0021]] (doplňuje, nenahrazuje), [[10-interakce#Režimy a HUD (M19)]], [[09-vykreslovani#Manipulátory]], [[11-ui]], [[M19-manipulator-fusion|M19]]

## Kontext

Manipulátor z [[M18-manipulatory|M18]] byl podle Pavla „trochu bída“. Tři celé kružnice kolem jednoho středu se překrývají se šipkami i mezi sebou, posouvat jde jen po jedné ose, střed otáčení nejde táhnout a hodnota je jen štítek bez možnosti psát. Vzorem je manipulátor Move/Copy ve Fusion 360: šipky, čtverce pro posun v rovině, oblouky pro rotaci, středový bod, přepínatelné režimy (Move Type) a režim Set Pivot ([dokumentace Autodesku](https://help.autodesk.com/cloudhelp/ENU/Fusion-Model/files/GUID-FFD25CD3-0707-429E-B0E6-B7F9984CDC4C.htm)).

Rozhodnutí s Pavlem (2026-10-14): převzít všechno (oblouky, čtverce a střed, režimy, nastavení pivotu, editovatelné pole). Rotace Transformace jako tři úhly. Přepínač režimů v liště u manipulátoru, výchozí režim Volný (vše najednou), v režimu Rotace celé kružnice.

## Rozhodnutí

1. **Úchyty se dvěma a třemi stupni volnosti.** Čočka už nepracuje jen se skalárem: `planar` (hodnota `[a, b]` v bázi `u`, `v`) a `point` (hodnota `Vec3`, tah v rovině kolmé na pohled při stisku). Skalární úchyty (`linear`, `angular`) zůstávají a jen ony mají editovatelné pole. `angular` dostane `extent: 'quarter' | 'full'`.
2. **Režimy deklaruje deskriptor.** `modes` (první výchozí) a `frame(params, anchors, mode)` místo `handles()`. Režim je stav UI v controlleru, ne v dokumentu, a nová session začíná výchozím. Volitelné `pickPoint(params, anchors, mode, point)` je obecný „klik na model“ (pivot Transformace).
3. **HUD je prezentační model v `interaction` a kreslí ho `ui`.** Controller vystaví `hud` (režimy, `center` ve světě, pole hodnoty s `at` a `direction` ve světě) a příkazy `setMode`, `setValue`. `ui` si polohu na obrazovce spočítá přes `ViewportPort.project` a přesune prvky při `viewChanged`. Štítek kreslený v `render` zaniká.
4. **Pivot jako čočka.** Režim pivotu má vlastní úchyty, jejichž `toParams` zapisuje `pivot`, `pivotPoint` a vyrovnávací `translate`. Těleso tak při posunu pivotu stojí. Controller ani `render` o pivotu nevědí.

## Zvažované alternativy

- **Režim jako parametr featury** (uložený v dokumentu): režim je jen způsob editace, ne vlastnost výsledku. V dokumentu by zbytečně zvětšoval recept a undo by přepínalo režimy.
- **Lišta a pole kreslené v `render`** (jako dosavadní štítek): `render` nezná překlady, ikony ani formátování čísel (ADR 0014). Editovatelné pole je formulářový prvek, ten patří do `ui`.
- **Lišta v dialogu featury:** Pavel chtěl lištu u manipulátoru, blíž myši. Obecné řešení přes `hud.modes` umožní později i variantu v dialogu.
- **Rotace jako kvaternion:** věrnější volné rotaci ve Fusion, ale v dialogu nečitelná a needitovatelná čísly. Zvoleny tři úhly s kardanovými oblouky.

## Důsledky

- (+) Pivot, rovinný posun i oblouky jsou čisté deklarace v pluginu. Controller zná jen druhy úchytů, ne Transformaci.
- (+) Lišta a pole jsou testovatelné jako prezentační model v Node, `ui` jen kreslí.
- (−) `ManipulatorDescriptor` mění tvar (`handles` → `frame`, `display` → `displayScale`). Oba pluginy (Transformace, Extrude) se upraví v M19.
- (−) `ViewportPort` roste o `project` a `viewChanged`. `ui` přesouvá DOM prvky při každém snímku animace kamery.
- (−) V režimu s `pickPoint` bere controller klikání nad modelem, takže výběr do referenčního pole dialogu v tu chvíli nejde.
