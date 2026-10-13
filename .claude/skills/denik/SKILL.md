---
name: denik
description: Zapíše nebo doplní dnešní záznam v deníku vaultu tinycad (docs/80-denik/RRRR-MM-DD.md) a zkontroluje vlastnost updated u změněných poznámek. Použij na konci každého pracovního sezení a po dokončení milníku nebo většího kroku.
---

# Deník sezení

1. Dnešní datum: `date +%F`. Soubor: `docs/80-denik/<datum>.md`.
2. Zjisti, co se v sezení změnilo: z konverzace, a pokud existuje git, i z `git status` a `git diff --stat`. Projdi i změny v `src/` a `docs/`.
3. Když soubor neexistuje, vytvoř ho ze šablony `docs/00-meta/sablony/Deník.md` a nahraď `{{date:YYYY-MM-DD}}`. Když existuje, **doplň** stávající sekce a nic nepřepisuj.
4. Obsah drž krátký a faktický, česky, s wikilinky na dotčené poznámky:
   - **Změny:** co vzniklo nebo se změnilo (`[[M03-operace]]: hotové úkoly 1–3`, `nové ADR [[0009-…]]`).
   - **Rozhodnutí:** co se rozhodlo a kde je to zapsané (otázka, ADR).
   - **Další krok:** 1–3 konkrétní body.
5. Vlastnosti: `summary` = jedna věta za celý den (při doplnění ji aktualizuj). Do `milestones` dej milníky, na kterých se pracovalo, jako `"[[M03-operace]]"`.
6. Ověř `updated`: u každé poznámky ve vaultu, která se dnes obsahově změnila, musí být dnešní datum. Hook `vault-lint` ho nastavuje sám, takže to hlavně zkontroluj spuštěním `node scripts/vault-lint.mjs`.
