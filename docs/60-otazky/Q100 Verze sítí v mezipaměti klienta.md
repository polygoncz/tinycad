---
type: question
status: answered
area: "[[14-protokol]]"
decide_by: "[[Roadmapa]]"
proposal: "Klient v každém požadavku, který vrací read model, pošle seznam verzí sítí, které drží; server přiloží síť jen k tělesu s jinou verzí."
decision: "Klient posílá known_meshes (seznam content_version) v ReadModelOptions; server je vůči mezipaměti klienta bezstavový; content_version je neprůhledný řetězec jedinečný i přes restart serveru."
tags:
  - otazka
created: 2026-10-17
updated: 2026-10-17
---
# Q100 Verze sítí v mezipaměti klienta

**Oblast:** [[14-protokol]], [[Q099 Read model po regeneraci|Q099]], [[09-vykreslovani]] · **Rozhodnout do:** [[Roadmapa|plánování série nativního jádra]]

## Otázka

[[Q099 Read model po regeneraci|Q099]] rozhodla, že síť [[Těleso|tělesa]] jde v read modelu jen tehdy, když se změnila jeho `content_version`. Nechala otevřené, jak server pozná, které verze už klient má.

## Možnosti a návrh

**A. Klient je pošle (návrh).** Každý požadavek, který vrací read model, nese `known_meshes`.
- \+ Server je vůči mezipaměti klienta bezstavový. Funguje po výpadku sítě, po reloadu karty i pro druhou kartu bez zvláštní logiky.
- \+ Ztracená odpověď nic nerozbije: klient síť nedostal, tak ji příště nenahlásí a server ji pošle znovu.
- − Pár desítek bajtů navíc v každém požadavku.

**B. Server si pamatuje, co poslal.**
- \+ Menší požadavky.
- − Ztracená odpověď znamená, že server si myslí, že klient síť má, a klient ji nemá. Reload karty potřebuje reset. Stav na dvou místech se rozejde.

**C. Klient si sítě stáhne zvlášť (`GetMeshes`).**
- \+ Odpověď na operaci je vždy malá.
- − Každá změna tvaru stojí druhou cestu na server, proti Q099 („výsledek v odpovědi“).

## Rozhodnutí

**Varianta A (Pavel 2026-10-17, podle návrhu Clauda).** Upřesnění při zápisu `.proto` (Claude):

- `known_meshes` je **seznam** verzí, ne mapa `BodyId → verze`. Stejné těleso může být zároveň ve vstupu editované featury a v konečném stavu s jiným tvarem ([[0025-vstupni-stav-editovane-featury|ADR 0025]]), klient tedy drží dvě sítě pod jedním `BodyId`.
- `content_version` je **neprůhledný řetězec** (`<epocha procesu>.<n>`), ne číslo. Čítač by se po restartu serveru začal počítat znovu a klient by pod starou verzí ukázal cizí síť.
- Klient smí zahodit sítě, jejichž verzi v posledním read modelu nevidí.

Propsáno do [[14-protokol#Read model a sítě]].
