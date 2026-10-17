---
type: adr
status: accepted
number: 30
aliases:
  - ADR 0030
  - Nativní jádro tinycad-core přes gRPC
date: 2026-10-17
related:
  - "[[0013-replicad-opencascadejs]]"
  - "[[14-protokol]]"
  - "[[01-architektura]]"
  - "[[06-geometricke-jadro]]"
  - "[[05-persistence]]"
  - "[[Q094 Nativní jádro na serveru přes gRPC]]"
supersedes: "[[0002-occt-wasm-ve-workeru]]"
tags:
  - adr
created: 2026-10-17
updated: 2026-10-17
---
# 0030 – Nativní jádro `tinycad-core` přes gRPC

- **Stav:** Přijato (`status: accepted`, Pavel 2026-10-17). [[0002-occt-wasm-ve-workeru|ADR 0002]] a [[0013-replicad-opencascadejs|ADR 0013]] jsou tím nahrazené (`status: superseded`). Do konce [[M46-klient-nad-read-modelem|M46]] ale WASM verze dál běží.
- **Datum:** 2026-10-17
- **Nahrazuje:** [[0002-occt-wasm-ve-workeru|ADR 0002]] (OCCT ve WASM ve Web Workeru) a [[0013-replicad-opencascadejs|ADR 0013]] (build `replicad-opencascadejs`)
- **Souvisí:** [[14-protokol]], [[Q094 Nativní jádro na serveru přes gRPC|Q094]], [[Q096 Geometrie skici přes síť|Q096]]–[[Q105 Viditelnost parametru jako data|Q105]]

## Kontext

Od [[M07-kernel-occt|M7]] běží OCCT ve WASM ve Web Workeru za portem `GeometryKernel` ([[0002-occt-wasm-ve-workeru|ADR 0002]]) a dokument, operace, regenerace i persistence jsou TypeScript v prohlížeči. Pavel chce v malém postavit stack, jaký zná z práce kolem RFEM: jádro bez UI, se kterým se mluví přes gRPC ([[Q094 Nativní jádro na serveru přes gRPC|Q094]]). Důvod je výukový, ne výkon. Jeden uživatel, dokumenty na serveru, lokálně v Dockeru. Série skicáře M30–M37 je hotová, doména je známá a dá se zmrazit.

Předpřipravený WASM build měl známé dluhy, které měl řešit [[M16-vlastni-occt-build|M16]]: chybějící třídy (`TopExp::MapShapes`, `BOPAlgo`, fonty), únik paměti ([[Q054 Únik paměti v OCCT buildu|Q054]]) a posun zásobníku po výjimce ([[Q055 Pád WASM jádra|Q055]]). Nativní OCCT je nemá.

## Rozhodnutí

1. **Nativní C++ jádro `tinycad-core`** vlastní dokument, [[Operační log|operační log]], [[Transakce|transakce]], undo, [[Regenerace|regeneraci]], [[Topologické pojmenování|topologické pojmenování]], buildery featur a jejich schémata a OCCT. Přepíše se **naráz** z TS domény zmrazené po M37. Její testy jsou specifikace C++ verze (sdílené testovací případy, [[M38-zmrazeni-domeny|M38]]).
2. **OCCT nativně v nejnovější verzi z registru vcpkg** (dnes 8.0.1), přes **vcpkg** v režimu manifestu s připnutou baseline, kterou posouváme vědomě při startu milníků série; dále gRPC, protobuf, SQLite, GoogleTest. planegcs se vendoruje ze zdrojů ([[Q104 Nástroje pro kontrakt a C++ server|Q104]]).
3. **Kontrakt v `.proto`** (`server/proto/tinycad/v1/`, [[14-protokol|spec 14]]): `DocumentService`, `SessionService` a bezstavová `GeometryService`. Podle čtyř zásad Q094: sezení nezávislé na spojení, idempotentní změny s `operation_id`, navazovaný stream událostí se `seq`, chyby jako `google.rpc.Status` s typovaným `ErrorDetail`. Kontrakt hlídá `buf lint` a `buf breaking`.
4. **Prohlížeč přes gRPC-Web a Envoy.** Klient z protobuf-es a `@connectrpc/connect-web`. Envoy jen překládá gRPC-Web na gRPC, přidává timeouty a health check. Vše běží v **Docker Compose** na localhostu. Přihlášení, TLS a vystavení na internet jsou mimo rozsah.
5. **Řešič skici zůstává v klientovi**, server je autorita: při každém `Apply` se `setParams` skici ji znovu vyřeší nativním planegcs a platí jeho výsledek ([[Q097 Transakce a undo přes RPC|Q097]]). Klient si ponechá jen model skici (`sketch`, `solver-planegcs`, `text-opentype`) a 2D geometrii skicáře volá přes `GeometryService` za nezměněným portem `SketchGeometry` ([[Q096 Geometrie skici přes síť|Q096]]).
6. **Klient zná jen read model** ([[Read model]]): vždy celý malý snímek, sítě jen u těles s novou `content_version`, kterou klient hlásí v `known_meshes` ([[Q099 Read model po regeneraci|Q099]], [[Q100 Verze sítí v mezipaměti klienta|Q100]]). Schéma featur přijde jako `FeatureTypeDescriptor` ([[Q098 Schéma featur v klientovi|Q098]], [[Q105 Viditelnost parametru jako data|Q105]]). Validace je jen na serveru.
7. **Úložiště: jeden SQLite soubor na dokument** v Docker volume, s tabulkami `operations` (append-only, `operation_id` s unikátním indexem) a `snapshots`. Záznam je JSON operace ze [[04-operace-a-historie|spec 04]] s `v` a `upcast`; `.proto` je formát přenosu, ne úložiště ([[Q101 Operace v kontraktu proto|Q101]]). `.tinycad.json` zůstává formátem importu a exportu. IndexedDB přestává být zdrojem pravdy.
8. **Jeden repozitář.** Server je ve složce `server/` s vlastním CMake. `npm run check` dostane kroky `check:proto` a `check:server`.
9. Prohlížeč přestane obsahovat `kernel-occt`, `regen`, `ops`, `persistence` a buildery featur. Ze `src/` je odstraní [[M47-uklid-a-dokonceni|M47]], zůstanou v historii gitu. Specifikace a milníky ve vaultu zůstávají jako záznam návrhu.

## Zvažované alternativy

- **Vlastní WASM build ([[M16-vlastni-occt-build|M16]])** – opraví dluhy buildu, ale výukově nepřidá serverovou architekturu, kterou Pavel chce. M16 se archivuje.
- **Postupně (strangler fig)** – nejdřív vzdálený adaptér portu `GeometryKernel`, doména v TS, pak přesun po částech. Bezpečnější, ale handle tvarů by putovaly přes síť a doména by se psala dvakrát. Zamítnuto v Q094. Výjimkou je bezstavová `GeometryService`, která jde první ([[M39-kostra-serveru|M39]]), protože nemá doménový stav.
- **Řešič skici na serveru** – tažení přes síť, „odkudkoli“ nepoužitelné (Q094 bod 1).
- **WebSocket s vlastním protokolem** místo gRPC – víc volnosti (obousměrný stream), ale ztratí se generovaný kontrakt pro C++ i TS, který je cílem cvičení.
- **Postgres** – pro jednoho uživatele zbytečný kontejner navíc. SQLite zachová dokument jako soubor.
- **ts-proto, Conan 2, systémové balíčky, OCCT 7.9** – viz [[Q104 Nástroje pro kontrakt a C++ server|Q104]].

## Důsledky

- \+ Nativní OCCT 8 bez omezení WASM buildu: celé API, žádný únik z buildu, výjimky C++ bez posunu zásobníku, rychlé mapy podtvarů (`TopTools_IndexedMapOfShape`).
- \+ Pavel si projde celou cestu: `.proto` → generovaný C++ a TS kód → Envoy → prohlížeč, se zásadami, které platí i pro RFEM.
- \+ Jádro je čistý gRPC server, připojí se k němu i Python nebo C# klient napřímo.
- \+ Prohlížeč se zmenší o ~23 MB WASM a o ~15 000 řádků TS domény.
- − Dlouho nebude funkční celek klient + server. Zmírnění: zmrazení a sdílené testovací případy ([[M38-zmrazeni-domeny|M38]]), `GeometryService` jako první svislý řez ([[M39-kostra-serveru|M39]]), testy C++ od prvního dne.
- − Model skici je ve dvou jazycích (TS v klientovi, C++ na serveru) a může se rozejít. Zmírnění: sdílené případy skic a výsledků řešiče, které běží v obou sadách testů.
- − Každá změna v dialogu je cesta na server. Náhled offsetu a body křížení se „odkudkoli“ opozdí o 50–150 ms (přijato v Q096).
- − Vývoj potřebuje Docker a C++ toolchain. Build OCCT přes vcpkg trvá napoprvé desítky minut, binární cache vcpkg se drží ve volume.
- − Testy vyšších vrstev v klientovi přijdou o `FakeKernel` pod regenerací: klient regeneraci nemá, testuje se proti falešnému `SessionService` (fake read model).
- Specifikace [[01-architektura]], [[05-persistence]], [[06-geometricke-jadro]], [[07-regenerace]], [[09-vykreslovani]], [[10-interakce]], [[11-ui]] a [[12-skicar]] se přepíšou postupně v milnících, které je mění. Do té doby popisují WASM verzi, která běží.
