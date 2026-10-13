---
type: question
status: answered
area: "[[10-interakce]]"
decide_by: "[[M09-interakce]]"
proposal: "HighlightPort bere užší HighlightTarget"
decision: "HighlightPort bere HighlightTarget (kind, body, index) místo PickResult"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q065 Cíl zvýraznění bez bodu a normály

**Oblast:** [[10-interakce]] · **Rozhodnout do:** [[M09-interakce]]

## Otázka

`HighlightPort.setSelection` bere `PickResult[]` s povinnými `point` a `normal`, ale [[Výběr|výběr]] (`SelectionItem`) je nemá. `render` je přitom ignoruje (`sameTarget` porovnává jen druh, těleso a index, [[09-vykreslovani]]).

## Možnosti a návrh

1. **Užší `HighlightTarget`** – `{ kind: 'face'; body; faceIndex } | { kind: 'edge'; body; edgeIndex }`; `PickResult` je jeho nadtyp, takže hover jde předat beze změny.
   - + port říká jen to, co render opravdu potřebuje. − malá úprava `render`.
2. **Výběr drží celý `PickResult`.**
   - + port beze změny. − výběr nese data platná jen v okamžiku kliku.

Návrh: **1**.

## Rozhodnutí

2026-10-13 (Pavel): **možnost 1.** Propsáno do [[10-interakce]], dotkne se i [[09-vykreslovani]] (jen typy).
