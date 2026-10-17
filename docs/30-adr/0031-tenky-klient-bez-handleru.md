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
updated: 2026-10-18
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

## Provedení (M52)

Rozhodnutí platí beze změny; [[M52-tenky-klient|M52]] ho provedl a dotáhl podrobnosti, které ADR nechalo na plánování:

- [[Rozhodnutí nativního jádra#Plán M52 – tenký klient|N163]] – porty vrací `Promise<boolean>` (přijato / odmítnuto), bez událostí, `LogEntry` a zásobníků; [[Rozhodnutí nativního jádra#Plán M52 – tenký klient|N165]] – dokument klienta = neměnné snímky read modelu (`createSnapshotDocument`); [[Rozhodnutí nativního jádra#Plán M52 – tenký klient|N166]] – `ops` = typy operací, `OP_VERSION` a porty, testovací dvojník `FakeOps`, TS běžec `ops.script` pryč.
- [[Rozhodnutí nativního jádra#Plán M52 – tenký klient|N164]] ⚠ – jediný lokální stav změn jsou [[Rozpracované hodnoty dialogu|rozpracované hodnoty dialogu]]; bod 3 („poslední vyhrává“) se vykládá jako odpověď na **poslední odeslanou** změnu session. [[Rozhodnutí nativního jádra#Plán M52 – tenký klient|N172]] – skica dál posílá `setParams` po každé vyřešené úpravě.
- [[Rozhodnutí nativního jádra#Plán M52 – tenký klient|N167]] ⚠ – chyby transakce v tenkém dispečeru (ztracená transakce, `Abort` po odmítnutém `Commit`); [[Rozhodnutí nativního jádra#Plán M52 – tenký klient|N168]] ⚠ – odezva bez optimismu, ovládací prvky se nezakazují.
- [[Rozhodnutí nativního jádra#Plán M52 – tenký klient|N169]], [[Rozhodnutí nativního jádra#Plán M52 – tenký klient|N170]] – hlášení undo souběhu a jeden `ToastStack`; [[Rozhodnutí nativního jádra#Plán M52 – tenký klient|N171]] – pořadí úkolů.
- [[Rozhodnutí nativního jádra#M52 – Tenký klient|N175]] – ztracená transakce ukáže `notice.transactionLost`; [[Rozhodnutí nativního jádra#M52 – Tenký klient|N176]] – odmítnutí, které není `RemoteError`, je chyba programu; [[Rozhodnutí nativního jádra#M52 – Tenký klient|N177]] – sekce Text panelu skici a `RemoteAppSessionDeps` bez `now`.

Specifikace po M52: [[01-architektura]], [[03-dokument]], [[04-operace-a-historie]], [[10-interakce]], [[11-ui]], [[13-testovani]], [[14-protokol]].
