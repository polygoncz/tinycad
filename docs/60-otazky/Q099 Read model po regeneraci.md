---
type: question
status: answered
area: "[[07-regenerace]]"
decide_by: "[[Roadmapa]]"
proposal: "Po regeneraci celý malý read model (strom, stavy, kotvy, metadata těles s verzí obsahu), sítě jen u těles se změněnou verzí; klient drží mezipaměť sítí podle BodyId a verze."
decision: "Vždy celý malý read model, sítě jen u těles s novou content_version (mezipaměť podle BodyId a verze); výsledek v odpovědi na operaci, stream jen oznamuje novou generaci."
tags:
  - otazka
created: 2026-10-17
updated: 2026-10-17
---
# Q099 Read model po regeneraci

**Oblast:** [[07-regenerace]], [[09-vykreslovani]], [[Q094 Nativní jádro na serveru přes gRPC|Q094]] · **Rozhodnout do:** [[Roadmapa|plánování série nativního jádra]] (po M37)

## Otázka

Po rozdělení klient zná z domény jen model skici, všechno ostatní je read model z `.proto` (Q094 bod 3). Co přesně server pošle po každé [[Regenerace|regeneraci]] a kudy?

Dnes `render` synchronizuje tělesa podle identity `ShapeHandle`: nové handle teseluje, nezměněná nechá být (`SceneSync`, spec 01 „Tok dat jedné změny“). Klient po rozdělení handle nezná. Sítě jsou přitom zdaleka nejobjemnější část odpovědi. Během tažení manipulátoru nebo dialogu jde přitom regenerace za regenerací.

## Možnosti a návrh

**A. Pokaždé celý snímek včetně sítí.**
- \+ Nejjednodušší. Klient nedrží žádný stav mezi odpověďmi.
- − Při každém kroku dialogu jdou po síti sítě všech těles, i těch nezměněných. „Odkudkoli“ to bude znát.

**B. Celý malý read model, sítě jen změněných těles (návrh).** Strom featur, stavy, kotvy manipulátorů a metadata těles jdou vždy celé, jsou malé. Každé těleso nese `content_version`, kterou server zvýší, když se změní jeho tvar. Síť server pošle jen u tělesa s novou verzí. Klient drží mezipaměť sítí podle `BodyId` a verze.
- \+ Kopíruje dnešní princip (teseluje se jen nový handle), jen identitu handle nahradí verze obsahu.
- \+ Snímek stromu a stavů zůstává celý, takže nevzniká složitá logika rozdílů.
- − Server si musí pamatovat, kterou verzi už klient v sezení má. Nebo klient pošle v požadavku seznam verzí, které drží.

**C. Jemné rozdíly všeho (patche stromu, stavů i sítí).**
- − Složité na obou stranách, chyba v aplikaci patche rozbije stav klienta tiše. Dnešní objemy stromu a stavů to nevyžadují.

**Kudy:** výsledek regenerace v odpovědi na `ApplyOperation`, nebo ve streamu `WatchSession`? Odpověď je jednodušší a k operaci přímo patří. Stream ale potřebuje druhá karta téhož uživatele, která dokument jen sleduje. Návrh: v odpovědi, stream jen oznámí novou generaci (s `seq`) a klient bez vlastní operace si o read model řekne.

Návrh: **B** a výsledek v odpovědi. Zároveň platí upřesnění z výkladu: `bytes` sítě jde do `Float32Array` bez kopie jen tehdy, když `byteOffset` sedí na násobek 4. Jinak je nutná kopie.

## Rozhodnutí

**Varianta B, výsledek v odpovědi (Pavel 2026-10-17, podle návrhu Clauda).**

- Po regeneraci jde vždy celý malý read model: strom featur, stavy, kotvy manipulátorů, metadata těles, `canUndo`/`canRedo`. Každé těleso nese `content_version`, kterou server zvýší při změně tvaru. Síť jde jen u tělesa s novou verzí. Klient drží mezipaměť sítí podle `BodyId` a verze. Verze nahrazuje dnešní identitu `ShapeHandle` v `SceneSync`.
- Read model jde v odpovědi na operaci, která regeneraci vyvolala. Stream `WatchSession` jen oznámí novou generaci (se `seq`). Klient, který operaci neposlal (druhá karta), si read model vyžádá sám.
- Jak server ví, které verze klient má (pamatuje si je v sezení, nebo mu je klient pošle v požadavku), se upřesní při návrhu `.proto`.

Do specifikací ([[07-regenerace]], [[09-vykreslovani]]) se to propíše při plánování série nativního jádra.
