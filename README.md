# tinycad

Výuková parametrická CAD aplikace v prohlížeči, inspirovaná Onshape (jen modelovací část, tzv. Part Studio).

Cíl projektu je **naučit se**, ne konkurovat. Hlavní důraz je na čistou architekturu, objektový návrh a rozšiřitelnost: začneme jedním typem entity (kvádr) a postupně přidáváme další entity a nástroje, aniž bychom museli sahat do jádra.

## Stack

| Vrstva | Technologie |
|---|---|
| Jazyk | TypeScript (strict) v prohlížeči, C++ na serveru |
| Build | Vite (klient), CMake a vcpkg v Dockeru (server) |
| UI | Vue 3 (jen jako nejvyšší vrstva) |
| 3D vykreslování | Three.js |
| Geometrické jádro | OpenCascade (OCCT) nativně na serveru (`tinycad-core`), klient s ním mluví gRPC-Web přes Envoy |
| Řešič vazeb ve skicáři | planegcs (FreeCAD GCS ve WASM), zůstává v prohlížeči ve Web Workeru |
| Persistence | SQLite na serveru, operační log + snapshoty |
| Provoz | Docker Compose (jádro a Envoy) |
| Testy | Vitest, Playwright (e2e proti Compose), GoogleTest (server) |

Řešič vazeb `@salusoft89/planegcs` (GCS z FreeCADu) je pod licencí LGPL-2.0-or-later; používá se beze změn jako samostatný soubor WASM načítaný za běhu.

## Spuštění

Potřebuješ Node.js 26+ a běžící Docker (Docker Desktop).

```sh
npm install
docker compose up -d --build   # jádro tinycad-core a Envoy na :8080; první build trvá desítky minut
npm run dev                    # http://localhost:5173, /api se přeposílá na Envoy
```

Aplikace běží jen proti serveru, bez Compose se `npm run dev` k jádru nepřipojí. Dokumenty leží v pojmenovaném svazku `tinycad-data`.

## Testy

| Příkaz | Co dělá |
|---|---|
| `npm run check` | typecheck, lint, hranice modulů, kontrola vaultu, unit a integrační testy (bez Dockeru) |
| `npm run check:server` | build C++ jádra v Dockeru a jeho testy (GoogleTest, sdílené případy) |
| `npm run check:full` | `check` + `check:server` |
| `npm run test:e2e` | Playwright v Chrome proti produkčnímu buildu; sám zvedne vlastní Compose projekt `tinycad-e2e-<E2E_PORT>` s daty v tmpfs |
| `npm run test:e2e:full` | totéž v Chrome i WebKitu |

Souběžné e2e běhy potřebují jedinečné porty: `E2E_PORT=4411 E2E_CORE_PORT=18411 npm run test:e2e`.

## Dokumentace

Složka [`docs/`](docs/) je **Obsidian vault** – otevři ji v Obsidianu jako vault (*Open folder as vault*). Vstupní bod je `docs/Domů.md`, pravidla vaultu `docs/00-meta/Konvence vaultu.md`.

Mimo Obsidian se dá číst jako obyčejný Markdown, jen odkazy jsou ve tvaru `[[wikilink]]`.

## Stav

Výuková aplikace s nativním C++ jádrem za gRPC (série M38–M47). Stav milníků je ve vlastnostech souborů v `docs/40-plan/` a v přehledu na stránce *Roadmapa*.
