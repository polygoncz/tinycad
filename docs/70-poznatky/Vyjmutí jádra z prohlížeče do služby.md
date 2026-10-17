---
type: insight
status: seed
aliases:
  - Jádro do služby
  - Přesun domény na server
topics:
  - architektura
  - gRPC
  - přepis
sources:
  - "[[0030-nativni-jadro-pres-grpc]]"
  - "[[Rozhodnutí nativního jádra]]"
  - "[[M46-klient-nad-read-modelem]]"
tags:
  - poznatek
created: 2026-10-17
updated: 2026-10-17
---
# Vyjmutí jádra z prohlížeče do služby

**Shrnutí:** Přesun domény z prohlížeče do nativní služby šel naráz a bez dlouhého „nic nefunguje“ díky třem věcem: zmrazená doména se sdílenými případy jako pevným cílem, porty na hranici UI, které dovolily vyměnit jádro pod nezměněným UI, a e2e proti skutečné službě, které jako jediné odhalily chyby v pořadí odpovědí.

## Podrobnosti

- **Pevný cíl před přepisem.** Zmrazená TS doména a [[Sdílený testovací případ|sdílené případy]] (zaznamenané výstupy v JSON) daly C++ jasné „hotovo“ od prvního dne. Případy geometrie, řešiče i regenerace prošly v C++ bez úpravy jediného případu; kde se lišily, šlo o skutečný nález (viz [[Golden testy pro přepis do jiného jazyka]]).
- **Svislý řez nejdřív.** Bezstavová služba (2D geometrie) prošla celým stackem – vcpkg, `.proto`, Envoy, gRPC-Web, adaptér za portem – dřív, než existoval doménový stav. Riziko nástrojů (build OCCT 28 min, cache) se vyřešilo hned.
- **Souběh podle závislostí, ne podle pořadí v plánu.** Graf závislostí milníků ukázal, že jádro OCCT nepotřebuje model dokumentu a model skici nepotřebuje regeneraci; tři stopy a klient proti falešnému jádru zkrátily kritickou cestu. Kontrakty (hlavičky C++, `.proto`) se fixovaly před startem stop.
- **Optimistické zrcadlo za porty.** Klient drží kopii dokumentu, změnu použije hned svými handlery a po odpovědi serveru ji přestaví. UI, interakce i vykreslování se nezměnily; cenou je, že handlery operací zůstávají v klientovi.
- **Co unit testy nechytí.** Testy proti falešnému jádru prošly, ale e2e proti skutečné službě našly čtyři chyby v pořadí odpovědí v čase (starší read model přepsal novější, změna odešla bez kontextu dialogu, navázané sezení s otevřenou transakcí). Asynchronní hranice potřebuje test přes skutečný kanál včetně zpoždění a výpadku.
- **Revize vláken dřív než gRPC vrstva.** Revize architektury po doménových knihovnách našla zaseknutí (stream, který nikdy neskončí, vypnutí čekající na heartbeat, dlouhá práce pod globálním zámkem) – pravidla zámků zapsaná do specifikace dřív, než se psala služba, byla levnější než ladění.

## Jak to využívá tinycad

Série [[M38-zmrazeni-domeny|M38]]–[[M47-uklid-a-dokonceni|M47]] podle [[0030-nativni-jadro-pres-grpc|ADR 0030]]: C++ jádro `tinycad-core` (`server/src/`), kontrakt [[14-protokol]], klient nad [[Read model|read modelem]] ([[M46-klient-nad-read-modelem|M46]]). Bundle prohlížeče 10,1 → 2,8 MB gzip.

## Zdroje

- [[0030-nativni-jadro-pres-grpc|ADR 0030]], [[14-protokol]]
- [[Rozhodnutí nativního jádra]] (průběh a rozhodnutí N1–N145)
- Retrospektivy milníků M38–M47
