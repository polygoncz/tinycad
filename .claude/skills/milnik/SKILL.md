---
name: milnik
description: Zahájení nebo dokončení milníku tinycad podle Roadmapy a Konvencí vaultu. Použij, když Pavel řekne „začneme M3“, „/milnik start M03“, „M5 je hotový“, „/milnik konec M05“.
argument-hint: start|konec <Mnn>
disable-model-invocation: true
---

# Milník: start / konec

Argumenty: `$ARGUMENTS` (např. `start M03`, `konec M03`). Milník najdi jako `docs/40-plan/M<nn>-*.md`. `M3` i `M03` znamenají totéž.
Dnešní datum ve formátu `RRRR-MM-DD` zjisti příkazem `date +%F`.

Vždy dodržuj `docs/00-meta/Konvence vaultu.md` (sekce „Pravidla pro Clauda“). Stav měň **jen ve vlastnostech**, nikdy ho neopisuj do textu.

## start

1. Zkontroluj `depends_on` v milníku: každý závislý milník musí mít `status: done`. Pokud nemá, zastav se a řekni to Pavlovi.
2. Pokud už jiný milník má `status: doing` (`grep -l 'status: doing' docs/40-plan/*`), upozorni na to a zeptej se, jestli pokračovat.
3. Ve vlastnostech milníku nastav `status: doing` a `started: <dnes>`.
4. Přečti celý milník, všechny specifikace z `specs:` a ADR, na které odkazují.
5. Najdi otevřené otázky, které se musí rozhodnout do tohoto milníku:
   `grep -l 'decide_by: "\[\[<název souboru milníku>\]\]"' docs/60-otazky/*` a z nich ty se `status: open`.
6. Pokud je milník označený jako „hrubý plán“ nebo nemá akceptační kritéria, nejdřív navrhni upřesnění úkolů a kritérií a nech je Pavla schválit.
7. Shrň Pavlovi česky a stručně:
   - cíl milníku a co se v něm naučí,
   - úkoly v pořadí,
   - otázky, které musíme rozhodnout, každou s krátkým návrhem. **Nerozhoduj je sám.**
   - návrhová rozhodnutí, která nás čekají, a proč jsou důležitá.

## konec

1. Projdi úkoly a akceptační kritéria. U každého kritéria uveď, čím je splněné (test, příkaz, výstup). Pokud existuje `package.json`, spusť `npm run check` a ukaž výsledek. Když něco chybí, **nekonči milník** a vypiš, co zbývá.
2. Ověř, že otázky s `decide_by` na tento milník jsou `answered` nebo `dropped`. Otevřené vypiš a zeptej se.
3. Zkontroluj, že odchylky implementace jsou propsané do specifikací (`updated`, případně `status` specifikace → `implemented`).
4. Nastav `status: done` a `finished: <dnes>`.
5. Do sekce *Retrospektiva* napiš **návrh** (co bylo jinak, než se čekalo, co se osvědčilo) a nech ho Pavla doplnit nebo upravit.
6. Navrhni 1–3 obecné poznatky do `docs/70-poznatky/` (šablona *Poznatek*, `status: seed`). Založ je až po Pavlově souhlasu.
7. Vypiš otevřené otázky s `decide_by` na **další** milník a obsah `docs/01-inbox/` k roztřídění (inbox jen navrhni, nepřepisuj).
8. Doplň dnešní deník (skill `denik`).
