---
type: question
status: answered
area: "[[09-vykreslovani]]"
decide_by: "[[M11-dalsi-entity]]"
proposal: "S UI pro seznam těles"
decision: "Skrývání = metadata těles v dokumentu (body.setVisible, Q071, M11); průhlednost a barva odloženy do M15 jako Q073."
tags:
  - otazka
created: 2026-10-12
updated: 2026-10-14
---
# Q017 Průhlednost a skrývání těles

**Oblast:** [[09-vykreslovani]] · **Rozhodnout do:** [[M11-dalsi-entity]]

## Otázka

Kdy a jak přidat průhlednost a skrývání [[Těleso|těles]]?

## Možnosti a návrh

Až bude v UI seznam těles (pravděpodobně s booleany v M11).

## Rozhodnutí

2026-10-14 (Claude, noční rychloakce – [[Rozhodnutí noční rychloakce#M11 – Další entity|R15]]; k revizi Pavlem):

- **Skrývání** je od [[M11-dalsi-entity|M11]] součástí [[03-dokument#Metadata těles|metadat těles v dokumentu]]: `BodyMeta.hidden`, operace `body.setVisible`, Prohlížeč ho čte z dokumentu a `render` skryté těleso nevykreslí (`setBodyVisible`, beze změny od M10). Podrobnosti a proč až teď v přehodnocené [[Q071 Viditelnost těles|Q071]].
- **Průhlednost** (a s ní barva tělesa) se odkládá do [[M15-export-a-dokonceni|M15]] jako samostatná otázka [[Q073 Průhlednost a barva těles|Q073]]. V M11 pro ni není spotřebitel a průhledné materiály v Three.js (řazení, hloubkový buffer) s tématem M11 nesouvisí. Mechanismus metadat je na ni připravený (další pole `BodyMeta`).

Do [[09-vykreslovani]] se nic nepropisuje: port `setBodyVisible` z M10 zůstává.
