---
type: question
status: answered
area: "[[14-protokol]]"
decide_by: "[[Roadmapa]]"
proposal: "protobuf-es a connect-web pro TS, vcpkg v režimu manifestu pro C++, OCCT podle volby Pavla."
decision: "TS: protobuf-es a @connectrpc/connect-web (protokol gRPC-Web), buf na lint, generování a kontrolu zpětné kompatibility; C++: vcpkg v režimu manifestu s připnutou baseline; OCCT 8.0.1, připnuté přesně."
tags:
  - otazka
created: 2026-10-17
updated: 2026-10-17
---
# Q104 Nástroje pro kontrakt a C++ server

**Oblast:** [[14-protokol]], [[06-geometricke-jadro]] · **Rozhodnout do:** [[Roadmapa|plánování série nativního jádra]]

## Otázka

Tři volby nástrojů pro sérii nativního jádra ([[Q094 Nativní jádro na serveru přes gRPC|Q094]]): generátor TypeScriptu z `.proto` a klient gRPC-Web, správce C++ balíčků a verze [[Geometrické jádro|OCCT]].

## Možnosti a návrh

**Generátor TS**
- **protobuf-es + `@connectrpc/connect-web` (návrh):** oficiální generátor od Buf, prochází konformanční testy protobufu, ES moduly, `bytes` jako `Uint8Array`, `Struct` ↔ JSON vestavěně. Klient umí protokol gRPC-Web, takže sedí na Envoy. Nástroj `buf` přidá lint a kontrolu zpětné kompatibility (`buf breaking`).
- **ts-proto:** prostá rozhraní bez tříd, ale klient gRPC-Web potřebuje další knihovnu (starší `@improbable-eng/grpc-web` je opuštěná).

**Správce C++ balíčků**
- **vcpkg v režimu manifestu (návrh):** `vcpkg.json` a připnutá baseline, toolchain pro CMake, všechny porty existují (grpc, protobuf, opencascade, sqlite3, gtest). planegcs balíček není, vendoruje se zdroj.
- **Conan 2:** silný v binárních cache, ale balíček opencascade bývá pozadu.
- **Systémové balíčky v Dockeru:** nejjednodušší start, verze ale určuje distribuce a build mimo Docker se rozejde.

**Verze OCCT**
- **Poslední stabilní z vcpkg (návrh Clauda), stejná jako ve WASM, nebo nejnovější 8.x.**

## Rozhodnutí

**Pavel 2026-10-17:** protobuf-es + connect-web, vcpkg v režimu manifestu a **OCCT 8.x** (proti návrhu Clauda, který chtěl jen „poslední stabilní“).

Ověřeno 2026-10-17: OCCT 8.0.0 je vydané (vyžaduje C++17, přes 500 změn proti 7.9, průvodce migrací na dev.opencascade.org) a vcpkg ho má od vydání registru 2026.05.25. **Upřesnění (Pavel 2026-10-17): OCCT 8.0.1**, připnuté přesně ve `vcpkg.json` (`overrides`). Pokud baseline vcpkg 8.0.1 ještě nemá, přidá [[M39-kostra-serveru|M39]] vlastní overlay port v `server/vcpkg-ports/opencascade/` se zdrojem ze značky `V8_0_1`. Volba sedí s tím, že se adaptér píše znovu: nové API se neučí dvakrát. Rozdíly proti WASM buildu chytí sdílené testovací případy ([[M38-zmrazeni-domeny|M38]]).
