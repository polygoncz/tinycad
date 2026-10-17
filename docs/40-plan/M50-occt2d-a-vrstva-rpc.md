---
type: milestone
status: todo
order: 50
aliases:
  - M50
  - M50 Knihovna occt2d a vrstva rpc
modules:
  - server
specs:
  - "[[06-geometricke-jadro]]"
  - "[[14-protokol]]"
  - "[[01-architektura]]"
depends_on:
  - "[[M47-uklid-a-dokonceni]]"
started:
finished:
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M50 – Knihovna occt2d a vrstva rpc

**Cíl:** Server má jeden 2D základ OCCT (`occt2d`, N77) a doména nezná protobuf: `RuntimeDocument` vrací doménové výsledky a převod na zprávy dělá vrstva rpc (N53).

> Hrubý plán (2026-10-17) z Pavlových rozhodnutí sporných míst ([[Rozhodnutí nativního jádra#Pavlova rozhodnutí sporných míst (2026-10-17)]]). Před zahájením upřesnit úkoly, kontrakt a Implementační plán.

**Specifikace:** [[06-geometricke-jadro]], [[14-protokol]], [[01-architektura]]

**Navazuje na:** [[M47-uklid-a-dokonceni]]

## Úkoly

- [ ] Knihovna `tinycad_occt2d` (interní): převod `Curve2` na Geom2d, obálky, kontroly křivek, `compressKnots`; `tinycad_kernel` a `tinycad_geometry` nad ní, kopie pryč (N77).
- [ ] Vrstva rpc (`tinycad_rpc`): `GeometryServiceImpl`, `SessionServiceImpl`, `DocumentServiceImpl`, `ReadModelBuilder` (doménový read model → protobuf), převod chyb; `session` bez `.pb.h` v hlavičkách (N53).
- [ ] Doménový read model (`session::ReadModel` – dokument, regenerace, sezení, sítě podle verze) jako výsledek `RuntimeDocument`.
- [ ] Všechny sdílené případy a integrační testy přes gRPC beze změny zelené.

## Akceptační kritéria

- Žádný 2D kód OCCT dvakrát; `session` a níž nezávisí na `tinycad_proto`.
- `check:full` a e2e zelené.

## Co se naučíš

Jak vést hranici mezi doménou a přenosovým formátem a co stojí převod navíc.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
