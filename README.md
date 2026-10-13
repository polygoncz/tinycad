# tinycad

Výuková parametrická CAD aplikace v prohlížeči, inspirovaná Onshape (jen modelovací část, tzv. Part Studio).

Cíl projektu je **naučit se**, ne konkurovat. Hlavní důraz je na čistou architekturu, objektový návrh a rozšiřitelnost: začneme jedním typem entity (kvádr) a postupně přidáváme další entity a nástroje, aniž bychom museli sahat do jádra.

## Stack

| Vrstva | Technologie |
|---|---|
| Jazyk | TypeScript (strict) |
| Build | Vite |
| UI | Vue 3 (jen jako nejvyšší vrstva) |
| 3D vykreslování | Three.js |
| Geometrické jádro | OpenCascade (OCCT) zkompilovaný do WebAssembly, ve Web Workeru |
| Řešič vazeb ve skicáři | planegcs (FreeCAD GCS ve WASM) |
| Persistence | IndexedDB, operační log + snapshoty |
| Testy | Vitest |

## Dokumentace

Složka [`docs/`](docs/) je **Obsidian vault** – otevři ji v Obsidianu jako vault (*Open folder as vault*). Vstupní bod je `docs/Domů.md`, pravidla vaultu `docs/00-meta/Konvence vaultu.md`.

Mimo Obsidian se dá číst jako obyčejný Markdown, jen odkazy jsou ve tvaru `[[wikilink]]`.

## Stav

Projekt je ve fázi návrhu. Stav milníků je ve vlastnostech souborů v `docs/40-plan/` a v přehledu na stránce *Roadmapa*.
