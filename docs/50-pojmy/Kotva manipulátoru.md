---
type: concept
aliases:
  - Kotva
  - Anchor
code: "Anchor / FeatureAnchors"
module: "regen"
summary: "Pojmenovaný bod nebo směr ve světě, který builder vrátí z regenerace, aby na něj plugin postavil úchyty manipulátoru."
related:
  - "[[Manipulátor]]"
  - "[[Builder featury]]"
  - "[[Regenerace]]"
tags:
  - pojem
created: 2026-10-14
updated: 2026-10-14
---
# Kotva manipulátoru

Pojmenovaný bod se volitelným směrem (`{ point, direction? }`) ve světových souřadnicích. Vrací ho [[Builder featury|builder]] vedle stavu, například pivot Transformace nebo základnu Extrude. Kotva nese geometrii, kterou zná jen [[Regenerace|regenerace]] (vyřešené reference, obálky, roviny skic). Do `interaction` se dostane přes snapshot regenerace, takže `interaction` nemusí znát `regen`. Kotva smí záviset jen na vstupech, které úchyty [[Manipulátor|manipulátoru]] netáhnou. Živá část polohy úchytu se dopočítá z aktuálních params.

**V návrhu:** [[07-regenerace#Kotvy manipulátorů (M18)]], [[0021-manipulatory-kotvy-z-regenerace|ADR 0021]]
**Souvisí:** [[Manipulátor]], [[Stav regenerace]]
