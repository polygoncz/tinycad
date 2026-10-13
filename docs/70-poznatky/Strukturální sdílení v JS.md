---
type: insight
status: seed
aliases:
  - Structural sharing v JavaScriptu
  - Neměnná data bez knihovny
topics:
  - JavaScript
  - neměnná data
sources:
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/with
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/toSpliced
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze
  - https://immerjs.github.io/immer/
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# Strukturální sdílení v JS

**Shrnutí:** s metodami polí z ES2023 (`with`, `toSpliced`, `toSorted`) a `Object.freeze` na hranici jde dělat [[Neměnná data|neměnná data]] se strukturálním sdílením bez knihovny – a změnu pak pozná porovnání identity (`===`).

## Podrobnosti

- `arr.with(i, x)` a `arr.toSpliced(i, n, …)` vrátí **nové pole**, ale nezměněné prvky jsou tytéž objekty. Obdoba copy-on-write v C++: kopíruje se jen „páteř“, ne obsah.
- Díky tomu je detekce změny levná: první index, kde `nové[i] !== staré[i]`, je první změna. Žádné hashování ani hluboké porovnání.
- `readonly` v TypeScriptu hlídá jen překladač. `Object.freeze` hlídá za běhu, ale je **mělký** – je potřeba rekurzivní `deepFreeze`.
- Zkratka „už zmrazené přeskočit“ je past: objekt zvenku může být zmrazený jen mělce. Data na hranici zmrazit celá, uvnitř pak zmrazit jen nově vzniklou páteř (prvky už zmrazené jsou). Cena pak odpovídá velikosti změny.
- Snímek (snapshot) neměnných dat je zadarmo: stačí vrátit referenci.
- Knihovny (Immer, Immutable.js) dávají pohodlnější zápis nebo perzistentní struktury pro velká data. Pro desítky až stovky objektů stačí jazyk sám.

## Jak to využívá tinycad

- `CadDocument` v [[03-dokument|document]]: mutátory skládají nové `features` přes `with`/`toSpliced`, regenerace najde první změněnou featuru porovnáním identity ([[0006-nemenna-data|ADR 0006]], [[07-regenerace|spec 07]]).
- `deepFreeze` vždy, bez přepínače pro dev ([[Q027 Kdy mrazit doménová data|Q027]]); `toData` vrací referenci bez kopie.

## Zdroje

- MDN: `Array.prototype.with`, `Array.prototype.toSpliced`, `Object.freeze`.
- Immer – dokumentace.
