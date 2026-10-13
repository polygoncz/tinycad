---
type: insight
status: seed
aliases:
  - Parsovat, ne validovat
  - Hranice důvěry pro data zvenku
topics:
  - TypeScript
  - návrh typů
sources:
  - https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/
  - https://www.typescriptlang.org/docs/handbook/2/narrowing.html
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# Parse, don't validate

**Shrnutí:** data zvenku vstupují jako `unknown` a jediná funkce na hranici je ověří a převede na přesný typ – zbytek kódu pak už nic nekontroluje a typ nelže.

## Podrobnosti

- **Validace** odpoví ano/ne a data nechá ve stejném typu. Kód za ní musí „věřit“, že kontrola proběhla. **Parsování** vrátí nový, přesnější typ (nebo chybu), takže informaci o kontrole nese typ a překladač ji hlídá.
- V TypeScriptu: vstup je `unknown` (ne `any` a ne cílový typ), kontrola se dělá typovými strážemi (`v is T`) a výsledek je `Result<T, E>`. Neplatná data jsou očekávané selhání, ne výjimka.
- Vzor „nejdřív nahlásit, pak zúžit“: každé pole zkontrolovat zvlášť a nahlásit všechny chyby (s cestou), pak jednou kombinovanou podmínkou zúžit všechny typy najednou – bez `as`.
- Nominální („branded“) typy vznikají přetypováním **jen** v parseru. Všude jinde je značkovaný typ důkazem, že hodnota prošla kontrolou.
- Výstup parseru se staví znovu z ověřených polí: má přesně tvar typu, nic navíc.

## Jak to využívá tinycad

- `fromData(data: unknown)` v [[03-dokument|document]] vrací `Result<DocumentWriter, DocumentLoadError>` s cestami jako `studio.features[3].id` ([[Q026 Chyby při načítání dokumentu|Q026]]). Je jediné místo, kde načtené id dostane značku `FeatureId`.
- `FeatureSchema.validate(params: unknown)` – parametry featur v dokumentu jsou neověřené, typ `P` by sliboval něco, co platí až po kontrole.
- Kontrola „čistého JSON“ u `params`: IndexedDB ukládá structured clone, takže `Date` nebo `Map` by se jinak dostaly dovnitř.

## Zdroje

- Alexis King: *Parse, don't validate* (2019).
- TypeScript Handbook: Narrowing, type predicates.
