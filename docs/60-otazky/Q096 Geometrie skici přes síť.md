---
type: question
status: answered
area: "[[12-skicar]]"
decide_by: "[[Roadmapa]]"
proposal: "Port SketchGeometry v klientovi přes bezstavovou gRPC službu GeometryService; adaptér drží nejvýš jeden požadavek v letu, zpoždění náhledu offsetu a bodů křížení se přijme."
decision: "Bezstavová GeometryService za nezměněným portem SketchGeometry; adaptér drží nejvýš jeden požadavek v letu; zpoždění náhledu offsetu a bodů křížení se přijme."
tags:
  - otazka
created: 2026-10-17
updated: 2026-10-17
---
# Q096 Geometrie skici přes síť

**Oblast:** [[12-skicar]], [[06-geometricke-jadro]], [[Q094 Nativní jádro na serveru přes gRPC|Q094]] · **Rozhodnout do:** [[Roadmapa|plánování série nativního jádra]] (po M37)

## Otázka

[[Q094 Nativní jádro na serveru přes gRPC|Q094]] nechala [[Řešič vazeb|řešič vazeb]] a model [[Skica|skici]] v klientovi, aby tažení nešlo přes síť. Rozhodovala se ale ve stejný den jako [[0028-geometrie-skici-v-jadre|ADR 0028]] a se zjištěním, že od [[M30-geometrie-skici-v-occt|M30]] skicář volá OCCT i během editace, nepočítala:

- port `SketchGeometry` (`src/app/sketch-geometry.ts`): `intersections` (trim, extend, split – M33), `segment`, `fillet` (oblouk zaoblení – M34), `offset` (M35),
- oblasti skici pro vyplnění a picking (z artefaktu regenerace, ADR 0028 bod 3).

Po rozdělení OCCT v prohlížeči nebude. Jak se k těmto výpočtům skicář dostane?

## Možnosti a návrh

**A. Bezstavová služba `GeometryService` (návrh).** Port `SketchGeometry` v klientovi implementuje gRPC adaptér. Volání dostane křivky `Curve2` jako data a vrátí data, takže služba nepotřebuje sezení ani dokument. Na serveru je to tenká vrstva nad týmiž funkcemi jádra, které používá builder skici.
- \+ Port i nástroje skicáře se nemění, vymění se jen adaptér v `app`. Přesně to, k čemu jsou porty.
- \+ Kód je na latenci už připravený. Všechna volání jsou asynchronní a náhledy používají vzor „poslední požadavek vyhrává“, takže pozdní odpověď nic nerozbije.
- − Ne všechna volání jsou na klik (ověřeno v kódu 2026-10-17):
  - **na klik:** `segment` (trim, split), `fillet`, průsečíky u extend a chamfer,
  - **na pohyb myši:** náhled offsetu (`offset-tool.ts`, `onMove` → `geometry.offset`),
  - **po každé změně skici:** body křížení (`sketch-session.ts`, `requestHits` → `intersections`), na kterých stojí i trim pod kurzorem.

  „Odkudkoli“ se náhled offsetu a body křížení opozdí o 50–150 ms. Dnes jde jeden požadavek na každý pohyb myši. Přes síť to chce omezit na jeden požadavek v letu: další se pošle až po odpovědi, s poslední polohou. Snapper a ostatní náhledy pod kurzorem zůstávají v TS (ADR 0028 bod 5).

**B. Volání v rámci sezení (`SessionService`).** Stejné metody, ale s `session_id`. Server by mohl křivky vzít přímo z otevřené skici v dokumentu.
- \+ Klient nemusí posílat křivky, server je už má.
- − Klient má skicu rozpracovanou lokálně (Q094 bod 1), takže serverová kopie během editace nemusí sedět s tím, co uživatel vidí. Data stejně musí přijít od klienta.

**C. 2D geometrie zpět do TS.** Vrátit se před ADR 0028 a počítat průsečíky, zaoblení a offset v TS.
- \+ Žádná síť, synchronní odpovědi.
- − Popírá důvod ADR 0028 (vlastní numerická geometrie, neshoda s OCCT). Server by stejně počítal oblasti v OCCT a rozdíl mezi TS a OCCT by se vrátil.

**Oblasti pro vyplnění** se mění samy: přijdou v read modelu po regeneraci, jak to ADR 0028 bod 3 už dnes předpokládá. Během tažení se opozdí o jednu cestu na server a zpět, což ADR 0028 bod 5 připouští.

Návrh: **A**, s adaptérem, který drží nejvýš jeden požadavek v letu na každý druh volání. Nové API se neobjeví, port se jen přesune za síť. Zpoždění náhledu offsetu a bodů křížení „odkudkoli“ se přijme. Kdyby vadilo, náhled offsetu může přejít na TS odhad (jako snapper) a jádro počítá jen zápis.

## Rozhodnutí

**Varianta A (Pavel 2026-10-17, podle návrhu Clauda).** Port `SketchGeometry` zůstává beze změny. V klientovi ho implementuje gRPC adaptér nad bezstavovou službou `GeometryService` (křivky dovnitř, data ven, bez `session_id`). Adaptér drží nejvýš jeden požadavek v letu na každý druh volání: další pošle až po odpovědi, s posledním stavem. Zpoždění náhledu offsetu a bodů křížení „odkudkoli“ (50–150 ms) se přijme. Oblasti pro vyplnění přicházejí v read modelu po regeneraci ([[Q099 Read model po regeneraci|Q099]]).

Do specifikací ([[12-skicar]], [[06-geometricke-jadro]]) se to propíše při plánování série nativního jádra spolu s rozhodnutími [[Q094 Nativní jádro na serveru přes gRPC|Q094]]. Do té doby implementace zůstává ve WASM.
