---
type: question
status: answered
area: "[[01-architektura]]"
decide_by: "[[M37-text-ve-skice]]"
proposal: "Po M37 zmrazit TS doménu a naráz přepsat dokument, regeneraci a OCCT do nativního C++ jádra tinycad-core s gRPC; prohlížeč přes gRPC-Web a Envoy, vše lokálně v Docker Compose, v jednom repozitáři."
decision: "Po M37 naráz nativní C++ jádro tinycad-core s gRPC za Envoy (gRPC-Web), lokálně v Docker Compose, jeden repozitář; řešič skici v klientovi se serverem jako autoritou; SQLite soubor na dokument s operačním logem; klient zná jen model skici a read model; .proto podle čtyř zásad; M16 nahradí série serveru."
tags:
  - otazka
created: 2026-10-16
updated: 2026-10-16
---
# Q094 Nativní jádro na serveru přes gRPC

**Oblast:** [[01-architektura]], [[06-geometricke-jadro]], [[0002-occt-wasm-ve-workeru|ADR 0002]] · **Rozhodnout do:** [[M37-text-ve-skice|M37]] (před plánováním další série)

## Otázka

Brainstorming s Pavlem 2026-10-16: zbavit se OCCT ve WASM a postavit tinycad jako cloudovou aplikaci s nativním jádrem na serveru. Důvod je **výukový**: v malém si nasimulovat stack, jaký má Pavel v práci kolem RFEM, tedy desktopovou aplikaci, ze které jde vykuchat jádro komunikující přes gRPC. Nejde o výkon ani o chybějící třídy ve WASM buildu.

Co už vzešlo z rozhovoru (Pavlova slova, ne rozhodnutí):

- **Scénář:** jeden uživatel, dokumenty na serveru, otevře je odkudkoli. Spolupráce více lidí v reálném čase není cíl.
- **Kde běží:** zatím lokálně v Dockeru. Přihlášení, TLS a vystavení na internet jsou mimo rozsah.
- **Jazyk jádra:** C++, protože OCCT je v C++.
- **Rozsah:** jako Onshape. Server vlastní dokument a [[Regenerace|regeneraci]], ne jen geometrii.
- **Postup:** naráz, ne postupně přes vzdálený adaptér portu. Začne se **až po dokončení série M30–M37**.
- **Repozitář:** jeden (návrh Clauda, Pavel nerozporoval), viz níže.

Co zbývá rozhodnout před plánováním série milníků:

1. Kde se řeší skica během tažení: řešič `planegcs` ([[0016-planegcs-resic-vazeb|ADR 0016]]) v klientovi, nebo na serveru? _(rozhodnuto, viz níže)_
2. Formát a místo úložiště dokumentů na serveru. Co se stane s dnešní perzistencí v IndexedDB ([[05-persistence]])? _(rozhodnuto, viz níže)_
3. Co bude klient dál znát z domény: jen read model (strom featur, parametry, sítě) jako DTO, nebo i část modelu? _(rozhodnuto, viz níže)_
4. Návrh služeb a zpráv v `.proto`: sezení (otevření a uvolnění dokumentu v paměti jádra), operace, události, chyby. _(rozhodnuto, viz níže)_
5. Osud [[M16-vlastni-occt-build|M16]] (vlastní WASM build): archivovat, nebo nahradit milníkem nativního buildu? _(rozhodnuto, viz níže)_

## Možnosti a návrh

### Architektura (návrh)

```
Prohlížeč (Vue + Three.js, gRPC-Web klient z .proto)
   │  gRPC-Web, HTTP/1.1 nebo 2
   ▼
Envoy proxy (filtr grpc_web)          ┐
   │  gRPC, HTTP/2                    │ Docker Compose
   ▼                                  │ (localhost)
tinycad-core (C++, gRPC, OCCT)        │
   │                                  │
   ▼                                  │
úložiště (volume s dokumenty)         ┘
```

- **`tinycad-core`** je nativní C++ proces bez UI, obdoba vykuchaného jádra RFEM. Drží v paměti otevřený [[Dokument|dokument]], vede [[Operační log|operační log]] ([[0005-operacni-log|ADR 0005]]), regeneruje, dělá [[Topologické pojmenování|topologické pojmenování]] a volá OCCT nativně. Navenek je čistý gRPC server, takže by se k němu mohl připojit i Python nebo C# klient napřímo.
- **Envoy** překládá gRPC-Web na gRPC. Prohlížeč neumí HTTP/2 trailery, ve kterých gRPC posílá `grpc-status`. gRPC-Web je proto přesune do těla odpovědi. Jádro díky tomu zůstává bez kódu pro prohlížeč.
- **Dva kanály:** operace jako unární volání (`ApplyOperation` → `RegenResult`), události jako dlouho otevřený serverový stream (`WatchSession`: průběh regenerace, uložení). gRPC-Web neumí klientský ani obousměrný stream.
- **Sítě** jdou jako `bytes` (ploché pole `float32`), v TS jako `Uint8Array` → `Float32Array` bez kopie. Kontrakt bufferů ze [[06-geometricke-jadro|spec 06]] se tak skoro nemění.

### Přechod: naráz (Pavlova volba)

- Před přepisem se TS doména **zmrazí** a její testy (kontraktová sada jádra, testy regenerace a operací) poslouží jako specifikace C++ jádra. Bez zmrazení by se honil pohyblivý cíl.
- Přepisuje se zhruba 15 000 řádků TS: `document`, `ops`, `regen` (~5 300), `features`, `sketch` (~5 600), `kernel` a `kernel-occt` (~5 600), `persistence` (~2 100).
- Riziko: dlouho nebude existovat funkční celek klient + server. Zmírnění: silné testy C++ jádra od prvního dne.
- Zamítnutá alternativa: postupně (strangler fig), nejdřív vzdálený adaptér portu `GeometryKernel` přes gRPC a doména v TS, potom přesun domény po částech. Je bezpečnější, ale nevyužije se.

### Repozitář: jeden (návrh)

- Nová složka `server/` (název `core` je obsazený modulem `src/core`) s vlastním CMake a Docker buildem. Do `npm run check` přibude krok s testy serveru, ESLint a depcruise ji budou ignorovat.
- **Proč ne samostatný repozitář:** kontrakt v `.proto` spojuje klienta a server. V jednom repozitáři se změní v jednom commitu a nikdy se nerozejdou. Vault zůstane jeden zdroj pravdy. Samostatný repozitář dává smysl jen pro zahazovací spike, a i na to je složka `spikes/`.

### K otázce 1 (skica během tažení), návrh

Řešič nechat v klientovi kvůli tažení bez síťové latence. Onshape řeší skicu podobně, lokálně. `planegcs` je původem C++ z FreeCADu, takže na serveru poběží nativně tentýž kód, který je v klientovi ve WASM. Klient řeší tažení, server je autorita nad uloženou skicou.

## Rozhodnutí

Rozhodnuto po částech 2026-10-16, všechny body jsou uzavřené.

- **Bod 1, skica během tažení (Pavel 2026-10-16):** rozhoduje, co bude fungovat **odkudkoli**, ne co stačí na localhostu. Řešič `planegcs` proto zůstává v klientovi a tažení nejde přes síť. Server je autorita: při potvrzení úpravy skicu znovu vyřeší nativním `planegcs` a jeho výsledek platí. Důsledky:
  - Klient si ponechá model skici v TS (`sketch`, `solver-planegcs`). Bod 3 tím není „jen DTO“.
  - Hrozí, že se TS a C++ model skici rozejdou. Zmírnění: sdílené testovací případy (skici ve formátu dokumentu) a obě sady testů ověřují stejný výsledek řešiče.
  - Obousměrný stream (a tedy WebSocket vedle gRPC-Web) není kvůli skice potřeba.
  - Upřesnění 2026-10-17 ([[Q097 Transakce a undo přes RPC|Q097]]): „potvrzení úpravy“ je každé `Apply` se `setParams` skici (puštění myši), ne až „Hotovo“.
- **Bod 2, úložiště (Pavel 2026-10-16, podle návrhu Clauda):** jeden **SQLite** soubor na dokument v Docker volume. Uvnitř je operační log ([[0005-operacni-log|ADR 0005]]): tabulka `operations`, do které se jen přidává (`seq`, `operation_id` s unikátním indexem jako klíč idempotence, data operace), a tabulka `snapshots` s občasným celým stavem dokumentu, aby se při otevření nemusel přehrávat celý log. Důvody: dokument je dál vidět jako soubor, transakce a WAL chrání proti pádu, operace i klíč idempotence se zapíšou atomicky, žádný kontejner navíc. Postgres až pro víc uživatelů.
  - `seq` zároveň slouží k navázání streamu `WatchSession` po výpadku.
  - `.tinycad.json` zůstává formátem pro import a export. IndexedDB přestává být zdrojem pravdy, mezipaměť v klientovi je mimo rozsah.
- **Bod 3, co klient zná z domény (Pavel 2026-10-16, podle návrhu Clauda):** v klientovi zůstává z domény **jen model skici** (kvůli bodu 1), se kterým pracuje skicář a ven posílá operaci uložení skici. Všechno ostatní je **read model** generovaný z `.proto`: strom featur, parametry, stav regenerace, chyby a sítě. Klient ho jen čte. Validace parametrů je jen na serveru, chyba přijde v odpovědi, takže pravidla nejsou na dvou místech.
- **Bod 4, `.proto` (Pavel 2026-10-16, podle návrhu Clauda):** teď jen zásady, služby a zprávy se navrhnou při plánování série po M37, až bude známá doména po M37.
  1. **Sezení nezávislé na spojení:** jádro drží otevřený dokument pod `session_id`, ne pod spojením. Výpadek sítě dokument nezavře, uvolní se až po timeoutu nečinnosti.
  2. **Idempotentní operace:** každá nese `operation_id` vygenerované klientem. Opakované odeslání vrátí uložený výsledek, operace se neprovede dvakrát.
  3. **Navazovaný stream:** události `WatchSession` mají `seq`, klient se po výpadku připojí s posledním přijatým `seq` a dostane zbytek.
  4. **Chyby** jako `google.rpc.Status`, v podrobnostech typovaný doménový kód (dnešní `KernelErrorCode`), ne text.
  - Stabilitu dělají tyto zásady, ne Envoy. Envoy je jen překladač gRPC-Web na gRPC, přidává timeouty a health checky.
- **Bod 5, osud [[M16-vlastni-occt-build|M16]] (Pavel 2026-10-16, podle návrhu Clauda):** M16 nahradí série nativního jádra. Zatím se **nearchivuje**, jen se označí jako nahrazený. Do archivu se přesune, až vzniknou ADR a milníky série serveru, aby roadmapa nikdy neměla díru.

**Navazující otázky (2026-10-17, z procházení kódu po M37):** [[Q096 Geometrie skici přes síť|Q096]] (port `SketchGeometry` od M30 volá OCCT), [[Q097 Transakce a undo přes RPC|Q097]], [[Q098 Schéma featur v klientovi|Q098]], [[Q099 Read model po regeneraci|Q099]].

**Další krok:** při plánování série po M37 propsat rozhodnutí do specifikací ([[01-architektura]], [[06-geometricke-jadro]], [[05-persistence]]), napsat ADR, které nahradí [[0002-occt-wasm-ve-workeru|ADR 0002]] a [[0013-replicad-opencascadejs|ADR 0013]], a navrhnout `.proto`. Dnes se specifikace nemění, protože implementace je až do M37 dál WASM.


_(Až se rozhodne: vyplnit sem, nastavit `status: answered` a `decision`, rozhodnutí propsat do specifikace. Zásadní rozhodnutí → nové ADR, které nahradí [[0002-occt-wasm-ve-workeru|ADR 0002]] a [[0013-replicad-opencascadejs|ADR 0013]].)_
