---
type: insight
status: seed
aliases:
  - Spread místo výčtu polí
  - Mapa cesty vlastnosti vrstvami
topics:
  - návrh
  - TypeScript
sources:
  - src/ops/handlers/body.ts (oprava M24)
  - https://www.typescriptlang.org/tsconfig#exactOptionalPropertyTypes
tags:
  - poznatek
created: 2026-10-15
updated: 2026-10-15
---
# Výčet polí zahodí nové pole

**Shrnutí:** Kód, který objekt skládá výčtem polí (`{ name: m.name, color: m.color }`), tiše zahodí pole přidané později. Kód, který mění jedno pole přes `{ ...m, color }`, ho zachová. Před přidáním vlastnosti skrz vrstvy se vyplatí zmapovat cestu existující podobné vlastnosti a najít místa s výčtem.

## Podrobnosti

- **Typecheck nepomůže:** u volitelných polí je objekt bez nového pole pořád platný, takže výčet projde kompilátorem i stávajícími testy. Chyba se projeví až za běhu: změna viditelnosti tělesa smaže jeho materiál.
- **Kde výčet dává smysl:** kanonizace a validace (seznam povolených klíčů, porovnání po polích). Tam je výčet záměr a nové pole se do něj musí přidat. Takové výčty se vyplatí odvodit z jednoho zdroje (např. `Record` nad klíči), aby chybějící pole ohlásil typecheck.
- **Kde výčet škodí:** v operacích, které mají změnit jedno pole a zbytek nechat.
- **Odebrání pole bez `any`:** s `exactOptionalPropertyTypes` nejde napsat `{ ...m, color: undefined }`. `Object.fromEntries` vrací `{ [k: string]: any }` a skryje chybu typu. Bezpečná je typovaná funkce `omit<K extends keyof T>(m: T, key: K): Omit<T, K>` s destrukturováním.
- **Test, který chybu chytí:** objekt se všemi poli a každá operace musí změnit jen to své.

## Jak to využívá tinycad

[[M24-realisticke-zobrazeni|M24]]: `body.setVisible` a `body.setColor` skládaly metadata výčtem `{name, hidden}` a nový `material` by zahodily. Našla to mapa cesty barvy z M15 přes všech sedm vrstev ještě před psaním kontraktu ([[04-operace-a-historie#Sada operací]]). Souvisí s [[Implicitní kontrakty první implementace]].

## Zdroje

- `src/ops/handlers/body.ts`, oprava a typované `omit` z revize M24
- TypeScript: `exactOptionalPropertyTypes`
