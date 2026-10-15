---
type: insight
status: seed
aliases:
  - Literální typ jako pojistka shody
  - typeof konstanty přes import type
topics:
  - TypeScript
  - architektura
sources:
  - https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator
  - https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-8.html#type-only-imports-and-export
tags:
  - poznatek
created: 2026-10-15
updated: 2026-10-15
---
# Shoda hodnoty přes hranici jen pro typy

**Shrnutí:** Když modul smí z jiného brát jen typy, ale potřebuje kopii jeho konstanty, dá se shoda hlídat kompilátorem. Konstanta dostane literální typ (`'plastic' satisfies BodyMaterial`) a kopie je typovaná `typeof KONSTANTA` přes `import type`.

## Podrobnosti

- **Problém:** pravidlo závislostí (dependency-cruiser) povolí `render` z `interaction` jen `import type`. Výchozí materiál je ale hodnota, takže `render` má vlastní kopii. Test shody v `render` napsat nejde, protože pravidlo platí i pro testy modulu.
- **`satisfies` místo anotace:** `const D: BodyMaterial = 'plastic'` má typ celého výčtu, takže `typeof D` je `BodyMaterial` a nic nehlídá. `const D = 'plastic' satisfies BodyMaterial` ověří, že hodnota do výčtu patří, a zachová literální typ `'plastic'`.
- **`import type` stačí:** `import type { D }` dá k dispozici `typeof D` bez závislosti za běhu. Kopie `const MINE: typeof D = 'plastic'` při změně originálu na `'steel'` neprojde typecheckem (`Type '"plastic"' is not assignable to type '"steel"'`).
- **Ověřit, že pojistka chytá:** dočasně kopii změnit a pustit typecheck. Pojistka, kterou nikdo neviděl selhat, nic neznamená ([[Měření, které nemůže selhat]]).
- **Alternativy:** výjimka v pravidle závislostí pro testy (oslabí hranici), nebo předání hodnoty z kompozičního kořene (víc kódu).

## Jak to využívá tinycad

`DEFAULT_BODY_MATERIAL` v `document` a `DEFAULT_MATERIAL` v `render/body-layer.ts` (revize [[M24-realisticke-zobrazeni|M24]], [[03-dokument#Metadata těles]]). Navazuje na [[Čistý graf importů není čistá hranice]].

## Zdroje

- TypeScript 4.9: operátor `satisfies`
- TypeScript 3.8: `import type`
