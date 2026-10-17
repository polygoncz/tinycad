---
type: insight
status: seed
aliases:
  - Metatest pokrytí
topics:
  - testování
  - TypeScript
sources:
  - https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator
  - "[[M38-zmrazeni-domeny]]"
tags:
  - poznatek
created: 2026-10-17
updated: 2026-10-17
---
# Metatest pokrytí odvozený z kódu

**Shrnutí:** Akceptační kritérium typu „případy pokrývají všechny typy operací“ se dá proměnit v test, který čte sadu případů a požadovanou množinu bere z kódu; nový typ bez případu pak shodí build místo toho, aby čekal na revizi očima.

## Podrobnosti

- **Množina z kódu, ne opsaná:** kde existuje runtime seznam (`Object.keys(OP_VERSION)`, registrované pluginy, parametry schémat s `visibleWhen`), metatest ho čte přímo.
- **Sjednocení typů bez runtime seznamu** (`FeatureError['code']`, `SketchConstraint['kind']`): objekt `{ … } satisfies Record<Union, boolean>`. Chybějící nebo přebytečný klíč je chyba překladu (TS1360, TS2353), takže nový člen sjednocení vynutí rozhodnutí „pokrýt / vědomě vynechat“ (`false` s důvodem).
- **Kde ani to nejde** (`code: string`), seznam zůstává ruční a je potřeba to přiznat – metatest nový kód nepozná.
- **Každá kontrola musí umět selhat:** ověřit ji dočasným odebráním případu, který ji drží. Jedna úmyslná chyba pro celý test dokazuje jen jednu kontrolu (viz [[Měření, které nemůže selhat]]).
- Vědomé výjimky (nedosažitelný stav) patří do specifikace i do metatestu se zdůvodněním, ne mlčky vynechat.

## Jak to využívá tinycad

[[M38-zmrazeni-domeny|M38]], úkol 6: `test/integration/shared-cases/coverage.test.ts`, 16 kontrol nad [[Sdílený testovací případ|sdílenými případy]] (typy operací, featury, kódy chyb a statusy, metody geometrie, druhy vazeb, predikáty viditelnosti). Pravidla v [[13-testovani#Sdílené testovací případy]].

## Zdroje

- TypeScript 4.9: operátor `satisfies` – https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator
- [[M38-zmrazeni-domeny]]
