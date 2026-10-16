---
type: milestone
status: doing
order: 31
aliases:
  - M31
  - M31 Nové kreslicí nástroje
modules:
  - sketch
  - solver-planegcs
  - sketcher
  - render
  - ui
specs:
  - "[[12-skicar]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
depends_on:
  - "[[M29-spliny]]"
started: 2026-10-16
finished:
tags:
  - milnik
created: 2026-10-16
updated: 2026-10-16
---
# M31 – Nové kreslicí nástroje
**Cíl:** skicář umí obdélník středem a rohem, obdélník třemi body (natočený), samostatný bod, drážku (přímou středem i celkovou délkou, obloukovou), režim konstrukce pro nově kreslené entity a nekonečnou konstrukční přímku.


**Specifikace:** [[12-skicar#Data (`sketch`)]], [[12-skicar#Režim skicáře (sketcher)]], [[12-skicar#Rodiny nástrojů v liště]]

**Navazuje na:** [[M29-spliny|M29]]. Milník série *Rozšíření skicáře II* (M30–M37), viz [[12-skicar#Rozšíření skicáře II (M30–M37)]] a [[Roadmapa#Rozšíření skicáře II (M30–M37)]]. Stopa B; geometrii nemění, jen přidává entity a vazby, takže na [[M30-geometrie-skici-v-occt|M30]] nečeká.

## Rozsah

Pavel 2026-10-16: „Chtěl bych ještě dodělat do Sketch následující feature: obdélník zadaný středem a jedním krajním bodem, obdélník zadaný třemi body, možnost zadat bod, zadávat text, Construction Line, fillet a chamfer mezi dvěma hranami, trim, extend, split, offset, slot, mirror, linear a circular pattern.“

Upřesnění v sezení 2026-10-16:
- „Construction Line“ = **obojí**: přepínač režimu konstrukce (dokud je zapnutý, nové entity vznikají jako konstrukční; dnes jde jen přepnout už nakreslené) **a** nekonečná konstrukční přímka jako nová entita.
- „Možnost zadat bod“ = **obojí**: nástroj Bod (tady) a číselný vstup při kreslení ([[M32-ciselny-vstup|M32]]).
- Drážky: **přímá střed–střed, přímá celkovou délkou, oblouková**.

## Úkoly

- [ ] Nekonečná přímka v datech, řešiči a geometrii.
- [ ] Konstrukce obdélníků a drážek.
- [ ] Nástroje obdélník středem a třemi body, bod, přímka.
- [ ] Nástroje drážek.
- [ ] Režim konstrukce.
- [ ] Snapper, glyfy, e2e a spec.

## Implementační plán

Jeden úkol = jedno spuštění subagenta `implementer`. Sdílené typy: [[12-skicar#Sdílené kontrakty série II]] (xline, id nástrojů). Stopa B při úkolu 1 a 2 dopíše do spec 12 sekci *Nové kreslicí nástroje (M31)* se signaturami konstrukcí a vazbami každého tvaru (s Pavlem, jako hlavní sezení). Úkoly 3, 4 a 5 na sobě nezávisí (stojí na 1 a 2), ale všechny sahají do `sketch-tools.ts` – ve sdíleném worktree postupně, nebo v izolovaných worktree implementátorů.

### 1. Nekonečná přímka v datech

- **Soubory:** `src/sketch/model.ts` (`SketchXLine`, `SketchCurve`), `parse.ts` (povinné `construction: true`, cíle vazeb podle kontraktu), `edit.ts` (`constraintFor`, `dimensionFor`, `toggleConstruction` přeskočí, `removeItems`, `curvePoints`), `geometry.ts` (`curve2` → dlouhá úsečka, `XLINE_EXTENT`), `index.ts`; `src/solver-planegcs/solve.ts` (xline jako `line`); vyčerpávající `switch` jinde (`sketch-glyphs.ts`, `sketch-drawing.ts`, `snap.ts`) jen tak, aby prošly typy.
- **Testy:** `parse.test.ts`, `edit.test.ts` (každá vazba z tabulky kontraktu ano/ne), `geometry.test.ts`, `solve.test.ts` (bod na přímce mimo `p1p2`, rovnoběžnost úsečky s přímkou, kolmost), oblasti přímku ignorují.
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 2. Konstrukce obdélníků a drážek

- **Soubory:** `src/sketch/construct.ts` (čisté funkce: obdélník ze středu a rohu, obdélník ze tří bodů – třetí bod určí výšku kolmo na první stranu; drážka střed–střed, celkovou délkou a oblouková – každá vrátí entity a vazby jako koncept pro `addGeometry`, degenerovaný vstup → `null`), `index.ts`.
- **Vazby tvarů:** obdélník středem = 4 úsečky se sdílenými body, vodorovná/svislá, konstrukční úhlopříčka a `midpoint` středového bodu na ní; obdélník třemi body = `perpendicular` + `parallel` místo vodorovná/svislá; přímá drážka = 2 úsečky + 2 oblouky, tečnost ve 4 bodech, `equal` oblouků, konstrukční osa mezi středy (u celkové délky osa mezi krajními body přes oblouky); oblouková drážka = 2 soustředné oblouky se sdíleným středem + 2 koncové oblouky, tečnosti, `equal` koncových oblouků.
- **Testy:** `test/unit/sketch/construct.test.ts` – každý tvar: entity, vazby, orientace oblouků (`ccw`), degenerované vstupy; s planegcs: změna jedné kóty drží tvar.
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 3. Nástroje obdélníků, bodu a přímky

- **Soubory:** `src/sketcher/sketch-tools/rectangle-tool.ts` (parametrizovat druhem nebo nové soubory), `point-tool.ts`, `xline-tool.ts`, `sketch-tools.ts` (registrace, rodiny `rectangle` a `line`), i18n v `ui`.
- **Testy:** testy nástrojů s `FakeViewport` a `FakeSolver` (vzniklé entity a vazby, snapper na existující bod použije jeho id, Esc, náhled).
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 4. Nástroje drážek

- **Soubory:** `src/sketcher/sketch-tools/slot-tool.ts` (tři druhy jedním nástrojem parametrizovaným druhem: dva kliky osa + třetí šířka; oblouková: střed, začátek, konec + šířka), `sketch-tools.ts` (rodina `slot`), i18n.
- **Testy:** testy nástroje pro každý druh, degenerovaný vstup, Esc.
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 5. Režim konstrukce

- **Soubory:** `src/sketcher/sketch-session.ts` (`SketchState.constructionMode`, přepnutí), `sketch-actions.ts` a `constants.ts` (akce `sketch.constructionMode`, klávesa `Q`), společné místo zápisu geometrie nástrojů (`common.ts`) – v režimu konstrukce dostanou nové křivky `construction: true`; `ui` přepínač v liště (stav zapnuto).
- **Testy:** session (přepnutí, nástroj v režimu kreslí konstrukční křivky, body beze změny), akce a klávesa, lišta.
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 6. Snapper, glyfy, e2e a spec

- **Soubory:** `src/sketch/snap.ts` (přímka: jen `p1`, `p2` a `onCurve`), `src/sketcher/sketch-glyphs.ts` (kotva glyfu přímky v polovině `p1p2`), `test/e2e/m31.spec.ts` (obdélník středem, třemi body, drážka, bod, přímka s rovnoběžnou úsečkou, režim konstrukce), spec 12, 10 a 11.
- **Hotovo když:** e2e projdou, `npm run check` je zelený, spec odpovídá kódu.

## Akceptační kritéria

- Každý nový nástroj vytvoří správné entity a vazby, degenerovaný vstup nic, Esc zruší.
- Obdélník a drážka po změně jedné kóty zůstanou obdélníkem a drážkou (vazby drží tvar).
- V režimu konstrukce kreslí všechny nástroje konstrukční entity; nekonečná přímka nevstupuje do oblastí.

## Co se naučíš

Jak tvar popsat vazbami místo souřadnic (obdélník = 4 úsečky + rovnoběžnost/kolmost), a jak entita bez konce (přímka) projde datovým modelem, kresbou a pickingem.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Průběh stopy

_(Zapisuje stopa: rozhodnutí s Pavlem, odchylky od plánu, výsledky testů. Hlavní sezení to při sloučení přenese do deníku.)_

- **B1 (2026-10-16, Pavel schválil):** kontrakt konstrukcí v [[12-skicar#Nové kreslicí nástroje (M31)]] – každý tvar = funkce polohy (Vec2 → body, `null` pro degenerovaný vstup) a funkce topologie (id bodů → křivky a vazby); snapper nástroje stojí mezi nimi. Obdélník středem: H/V + konstrukční úhlopříčka a `midpoint` středu; obdélník 3 body: `perpendicular` + 2× `parallel`; přímá drážka: 4× `tangent` + `equal` + konstrukční osa (celkovou délkou: osa mezi konci + 4× `pointOnCurve`).
- **B2 (odchylka od plánu, Pavel schválil):** oblouková drážka bez `equal` koncových oblouků a bez konstrukčního oblouku osy – obojí plyne z tečností, řešič by to hlásil jako redundantní (vnitřní vazbu oblouku osy nejde vynechat, zahodila by se tečnost a soustava by byla degenerovaná).
- **B3 (Pavel):** první strana obdélníku 3 body, osa přímé drážky a konstrukční přímka dostanou `horizontal`/`vertical` z `inferLine` do 3° (automatické, Ctrl/Cmd vypne).
- **B4 (Pavel, jako Onshape):** režim konstrukce = rozšířená akce `sketch.construction` (`Q`): s křivkami ve výběru je přepne, bez nich přepne režim; tlačítko v liště svítí (`Action.checked`). Id `sketch.constructionMode` nevzniká (`Q` už patří `sketch.construction`, registr nedovolí dvě akce se stejnou zkratkou). Nové křivky označí pomůcka nástrojů `addDrawn`, ne `addGeometry`, aby režim nezasáhl úpravy jiných stop (trim, zrcadlení).

## Retrospektiva
