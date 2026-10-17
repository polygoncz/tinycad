---
type: adr
status: accepted
number: 31
aliases:
  - ADR 0031
  - Tenký klient bez handlerů operací
date: 2026-10-17
related:
  - "[[0030-nativni-jadro-pres-grpc]]"
  - "[[14-protokol]]"
  - "[[M52-tenky-klient]]"
supersedes:
tags:
  - adr
created: 2026-10-17
updated: 2026-10-17
---
# 0031 – Tenký klient bez handlerů operací

- **Stav:** Přijato jako směr (`status: accepted`, Pavel 2026-10-17 na stránce sporných míst). Podrobnosti chování UI při čekání na server se dotáhnou při plánování [[M52-tenky-klient|M52]].
- **Datum:** 2026-10-17
- **Souvisí:** [[0030-nativni-jadro-pres-grpc|ADR 0030]] bod 9, [[14-protokol]], [[Rozhodnutí nativního jádra]] N63, N76

## Kontext

Samostatný běh M46 zvolil optimistické zrcadlo dokumentu (N63): klient každou změnu hned použije vlastními TS handlery operací a po odpovědi serveru ji přestaví. UI se díky tomu nemuselo měnit, ale v prohlížeči zůstal modul `ops` (handlery, `applyOperation`) a model dokumentu – tedy druhá implementace domény, kterou ADR 0030 bod 9 chtěla z prohlížeče odstranit. Dvě implementace se mohou rozejít a pořadí odpovědí v zrcadle byl zdroj chyb, které našly až e2e (N136).

## Rozhodnutí

1. **Klient nemá handlery operací ani vlastní dokument, který by měnil.** Stav dokumentu je jen read model ze serveru; klient posílá operace a zobrazuje odpověď.
2. **Server je jediná implementace domény.** `src/ops` (handlery, `applyOperation`, paměťový dvojník) a měnitelný model v `src/document` z klienta zmizí; zůstanou typy operací a čtecí pohled na dokument z read modelu.
3. **Okamžitá odezva tam, kde je potřeba, přes server:** úpravy v dialogu a tažení jdou přes `ApplyTransient`/`Apply` v transakci a pohled ukazuje read model odpovědi; „poslední vyhrává“ mezi odpověďmi zůstává. Skica se dál řeší lokálně (řešič je v klientovi, ADR 0030 bod 5) a na server jde jako `setParams` po potvrzení úpravy.
4. Rozhraní, která UI používá (`OperationDispatcher`, `Transaction`, `UndoManager`, čtení dokumentu), zůstanou jako porty; jejich vzdálená implementace jen neaplikuje nic lokálně.

## Zvažované alternativy

- **Optimistické zrcadlo (dnešní stav, N63)** – nejrychlejší odezva a nezměněné UI, ale dvě implementace domény a složitá pravidla pořadí. Pavel ho odmítl.
- **Zrcadlo jen pro vybrané operace** (např. přejmenování) – snižuje latenci jen u triviálních změn, složitost zůstává.

## Důsledky

- \+ Jedna implementace domény (C++), žádné rozcházení klienta a serveru, jednodušší pravidla pořadí (odpověď = stav).
- \+ Z klienta zmizí další kód (`ops`, měnitelný `document`) a jeho testy.
- − Každá změna mimo skicu je vidět až po odpovědi serveru (na localhostu desítky ms, „odkudkoli“ 50–150 ms). Dialog featur a manipulátory to musí zvládnout: stav „čeká na server“, slučování tažení.
- − Testy `interaction` a `sketcher`, které dnes stojí na paměťovém dvojníku `ops`, se musí přepsat na falešné vzdálené sezení.
