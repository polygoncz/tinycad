---
type: concept
aliases:
  - Artifact
  - Artefakty
code: "Artifact / ArtifactId"
module: "regen"
summary: "Jedna položka stavu regenerace s druhem (kind): těleso, od M12 skica, rovina, osa."
related:
  - "[[Těleso]]"
  - "[[Stav regenerace]]"
tags:
  - pojem
created: 2026-10-14
updated: 2026-10-14
---
# Artefakt

Jedna položka [[Stav regenerace|stavu regenerace]]. Všechny artefakty leží v jedné mapě `RegenState.artifacts` a liší se druhem `kind` ([[0015-artefakty-a-identita-telesa|ADR 0015]]): v M10.1 jen [[Těleso|těleso]], od [[M12-skicar|M12]] skica a počáteční roviny a osy vlastníka `origin`. Id má vždy tvar `<vlastník>/<druh>[:<n>]`, takže z něj jde přečíst featura, která artefakt vytvořila, a z referencí featur sestavit graf závislostí (`dependenciesOf` v [[03-dokument]]). Featury se na artefakty odkazují přes `EntityRef`, builder je čte z `BuildContext` (`resolveBodies`, později `resolvePlanes`).

**V návrhu:** [[07-regenerace]], [[03-dokument]]
**Souvisí:** [[Těleso]], [[Stav regenerace]]
