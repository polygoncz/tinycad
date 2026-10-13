---
type: concept
aliases:
  - Časová osa
  - Historie featur
code: "Timeline"
module: "ui"
summary: "Vodorovný pás dole v UI, který ukazuje featury Part Studia v pořadí, jejich stav a rollback bar."
related:
  - "[[Featura]]"
  - "[[Rollback bar]]"
  - "[[Prohlížeč]]"
tags:
  - pojem
created: 2026-10-13
updated: 2026-10-13
---
# Timeline

Ukotvený pás ve spodní části okna (podle Fusion 360). Ukazuje [[Featura|featury]] [[Part Studio|Part Studia]] zleva doprava v pořadí přehrávání: ikona typu, název v tooltipu a stav (v pořádku, chyba, potlačená, za barem). Tažením značky se posouvá [[Rollback bar|rollback bar]], dvojklik otevře dialog featury, pravé tlačítko kontextové menu s akcemi. Ukazuje *historii* (co uživatel zadal), na rozdíl od [[Prohlížeč|Prohlížeče]], který ukazuje *výsledek*. Data bere z `FeatureTreeModel` ([[Prezentační model]]), takže je to jen jiné vykreslení téhož modelu.

**V návrhu:** [[11-ui]], [[10-interakce]]
**Souvisí:** [[Rollback bar]], [[Prohlížeč]], [[Prezentační model]]
