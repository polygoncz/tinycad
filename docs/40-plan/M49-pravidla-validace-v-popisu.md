---
type: milestone
status: done
order: 49
aliases:
  - M49
  - M49 Pravidla validace v popisu typů
modules:
  - server
  - document
  - remote
specs:
  - "[[14-protokol]]"
  - "[[03-dokument]]"
  - "[[13-testovani]]"
depends_on:
  - "[[M47-uklid-a-dokonceni]]"
started: 2026-10-17
finished: 2026-10-17
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M49 – Pravidla validace v popisu typů

**Cíl:** Vlastní pravidla validace featur, která jdou popsat daty (dnes jediné: `boolean.sameBody`), jsou deklarativně ve `FeatureTypeDescriptor`, takže je dialog ukáže u pole ještě před odesláním, stejným kódem `ParamIssue` jako server (N67).

> Upřesněno 2026-10-17 (plánovač, [[Rozhodnutí nativního jádra#Plány M48–M51 (po nativním jádře)|N148–N150]]). Stopa C. Sdílený kontrakt se stopou A ([[M50-occt2d-a-vrstva-rpc|M50]]) je zafixovaný v kódu: `server/src/document/include/tinycad/document/param_rule.hpp` a `FeatureSchema::rules()` / `checkParamRules` v `schema.hpp`.

**Specifikace:** [[14-protokol#Schéma featur]], [[03-dokument]] (kódy chyb, vlastní pravidla), [[13-testovani#Sdílené testovací případy]]

**Navazuje na:** [[M47-uklid-a-dokonceni]]

## Inventura vlastních pravidel (2026-10-17)

Prošla se všechna `server/src/features/*/schema.cpp`. Nad rámec `validateAgainstSchema` (typ, meze, volby, tvar a počet referencí, `duplicateRef`, `visibleWhen`) jsou jen dvě vlastní pravidla:

| Featura | Pravidlo | Kód | Jde popsat daty? |
|---|---|---|---|
| `boolean` | těleso je v `targets` i v `tools`; hlásí se první takové v `tools` s `{ index }`, jen když obě pole prošla obecnou kontrolou | `boolean.sameBody` | **ano** – druh `DisjointRefs` |
| `sketch` | `entities` a `constraints` musí projít `Sketch::parse` (model skici, stovky řádků) | `sketch.invalidEntity`, `sketch.invalidConstraint` (`{ index }`) | **ne** – zůstává jen na serveru; skicář má vlastní model skici a do dialogu featur skica nejde |

`transform` má jen `migrate` (verze 1 → 3), ostatní featury jen obecnou kontrolu. Pravidlo „různé reference“ z hrubého plánu je obecná kontrola `param.duplicateRef` (už v klientovi) a mezi dvěma parametry právě `boolean.sameBody`.

## Úkoly

- [x] 1. C++: `checkParamRules` (druh `DisjointRefs`), pravidla v `BuiltInSchema`, boolean bez vlastního `validate`, kontrola pravidel v registru.
- [x] 2. Kontrakt: `schema.proto` (`FeatureTypeDescriptor.rules`, zprávy `ParamRule` a `DisjointRefs`, jen přidaná pole), převod `describeRule`, zlatý soubor `test/golden/feature-types.json`.
- [x] 3. Klient: `document/rules.ts` (stejné vyhodnocení), `remote/feature-types.ts` (`validate` = obecná kontrola + pravidla), dialog ukáže kód u pole.
- [x] 4. Sdílené případy: běžec TS `schema.validate` a `schema.visibleWhen` nad zlatým souborem; kódy jen serverových pravidel se z očekávání odfiltrují; metatest pokrytí pravidel.
- [x] 5. Spec 03, 13 a 14 a deník (hlavní sezení).

## Akceptační kritéria

- Dialog booleanu ukáže `boolean.sameBody` u pole `tools` dřív, než se změna odešle; kód i `{ index }` jsou stejné jako ze serveru.
- Všechny případy `schema.validate` a `schema.visibleWhen` zelené v C++ i v TS (TS bez kódů jen serverových pravidel); `npm run check:proto` (`buf lint` a `buf breaking`) prošel.
- Seznam pravidel, která zůstávají jen na serveru, je ve spec 03.
- `npm run check:full` zelený.

## Co se naučíš

Kde je hranice mezi deklarativním schématem a kódem validace a jak držet jedno pravidlo ve dvou jazycích přes sdílené případy – a proč se vyplatí pravidlo popsat daty i na serveru (jeden zdroj, žádná ručně psaná kopie v `BooleanSchema::validate`).

## Implementační plán

Úkoly 1–4 = jedno spuštění subagenta `implementer` (Opus), v pořadí 1 → 4. Úkol 5 dělá hlavní sezení. Pro všechny:

- **OOP a KISS (N9):** pravidlo je obyčejná struktura s `kind` (jako `ParamSpec`/`VisibleWhen`), vyhodnocení `switch` přes `kind`.
- **Build v Dockeru nejvýš `-j3` (N116)**; cíleně `tinycad_document_tests`, `tinycad_features_tests`, `tinycad_session_tests`, `tinycad_shared_cases_tests`; celý `npm run check:full` na konci úkolu 4 (N2).
- **Sdílený kontrakt se stopou A (N148):** `param_rule.hpp` a deklarace v `schema.hpp` se nemění. Kdyby bylo potřeba je změnit, implementátor to vrací jako otázku (stopa A proti nim kóduje).

### 1. Pravidla v C++ doméně

- **Soubory:** nový `server/src/document/rules.cpp` (+ `CMakeLists.txt` dokumentu), `server/src/document/schema.cpp` (kontrola v registru), `server/src/document/ref_kinds.{hpp,cpp}` (vystavit klíč reference pro pravidla, interně v knihovně), `server/src/features/schema_base.hpp` (pravidla v `BuiltInSchema`), `server/src/features/boolean/schema.{hpp,cpp}` (bez `validate`); testy `server/test/document/rules_test.cpp` (nový), `server/test/document/schema_test.cpp`, `server/test/features/schemas_test.cpp`.
- **Kontrakt (zafixováno v hlavičkách):**

```cpp
// tinycad/document/param_rule.hpp
struct ParamRule {
  enum class Kind { DisjointRefs };
  Kind kind; std::string code; std::string param; std::string other;
};
using ParamRules = std::vector<ParamRule>;

// tinycad/document/schema.hpp
void checkParamRules(const ParamSchema& schema, const ParamRules& rules, const Json& params,
                     std::vector<ParamIssue>& issues);
class FeatureSchema { … virtual const ParamRules& rules() const; /* default: none */ … };
```

  - `ref_kinds.hpp` dostane `std::vector<std::string> refKeyOf(const ParamSpec& spec, const Json& item)` (klíč reference jako u `duplicateRef`; prázdný vektor pro neplatnou položku) – `refKey` dnes leží v anonymním jmenném prostoru.
  - `BuiltInSchema`: konstruktor dostane `document::ParamRules rules = {}` jako poslední parametr; `rules()` je vrací; `validate` = `validateAgainstSchema` + `checkParamRules(params_, rules_, params, issues)`. `SketchSchema::validate` dál volá `BuiltInSchema::validate` a přidá `Sketch::parse`.
  - `BooleanSchema`: pravidlo `{ DisjointRefs, "boolean.sameBody", "tools", "targets" }`, vlastní `validate` zmizí.
  - `FeatureSchemaRegistry::add` navíc hlídá (AssertionError): `param` i `other` jsou ve schématu, oba druhu seznamu referencí (`Bodies`, `Topo`, `Region`, `Planes`; ne `Axis`), `param != other`, `code` neprázdný.
- **Sémantika `DisjointRefs` (stejná v TS):**
  1. Přeskočí se, když `params` není objekt, když `param` nebo `other` není viditelný (`isParamVisible`), nebo když `issues` obsahuje hlášení s `param` rovným `""`, `rule.param` nebo `rule.other`.
  2. Klíče položek `other` do množiny; první položka `param` (podle indexu), jejíž klíč v množině je, dá jedno hlášení `{ rule.param, rule.code, { index } }`.
  3. Pořadí hlášení: obecná kontrola, pak pravidla v pořadí `rules()`. (Pořadí není kontrakt, sdílené případy třídí.)
- **Testy:** `rules_test.cpp` nad malým schématem testu (dva seznamy `Bodies`; `Topo` a `Topo` se shodou `body` + `name`; skrytý parametr; rozbitý `other` → nic; první shoda podle indexu; parametry nejsou objekt → nic); `schema_test.cpp` – registr odmítne pravidlo nad neznámým parametrem, nad `Axis`, nad stejným parametrem; `schemas_test.cpp` – boolean má jedno pravidlo. Sdílené případy `validate-boolean-same-body*.json` beze změny zelené (důkaz, že přesun do dat nic nezměnil).
- **Hotovo když:** výše uvedené testy a `tinycad_shared_cases_tests` (schema) zelené.

### 2. Kontrakt proto a převod

- **Soubory:** `server/proto/tinycad/v1/schema.proto`, `server/src/session/src/feature_types.cpp` (+ deklarace, je-li potřeba, v `feature_types.hpp`), `server/test/session/feature_types_test.cpp`, `test/golden/feature-types.json` (přepsat `TINYCAD_UPDATE_GOLDEN=1`), `src/protocol` (vygenerované TS, `npm run gen:proto` běží samo před `typecheck`/`test`).
- **Kontrakt (`schema.proto`, jen přidaná pole – `buf breaking` musí projít):**

```proto
message FeatureTypeDescriptor {
  …
  // Rules beyond the generic checks (spec 03 "Vlastní pravidla", N67): the client reports the
  // same ParamIssue code at the field; the server decides. Empty for most types.
  repeated ParamRule rules = 7;
}

// A declarative rule of a feature type. A client that does not know the kind of a rule ignores
// it (the server still reports the issue in the read model).
message ParamRule {
  // ParamIssue.code and the translation key, 'boolean.sameBody'.
  string code = 1;
  oneof rule {
    DisjointRefs disjoint_refs = 10;
  }
}

// No reference of the list `param` is also in the list `other` (the same reference by the key
// of param.duplicateRef). Issue { param, code, { index } } at the first such item of `param`;
// checked only when both are visible and passed the generic checks.
message DisjointRefs {
  string param = 1;
  string other = 2;
}
```

  - `describeFeatureType` přidá `for (rule : schema.rules()) describeRule(rule, out->add_rules())`; `describeRule(const document::ParamRule&, v1::ParamRule*)` = `switch (rule.kind)`.
  - **Přesun do rpc (průnik se stopou A):** převodník popisů typů přesouvá [[M50-occt2d-a-vrstva-rpc|M50]] do `tinycad_rpc`. M49 píše `describeRule` jako samostatnou funkci na konec `feature_types.cpp`; když M50 sloučí dřív, slučovatel M49 ji přenese do `server/src/rpc/…/feature_types.cpp` (N148).
- **Testy:** `feature_types_test.cpp` – boolean má `rules` s `disjoint_refs { param: "tools", other: "targets" }` a kódem; ostatní typy prázdné; zlatý soubor přepsaný a test zlatého souboru zelený.
- **Hotovo když:** `npm run check:proto` zelený, `tinycad_session_tests` zelené, zlatý soubor obsahuje pravidlo booleanu.

### 3. Vyhodnocení v klientovi

- **Soubory:** nový `src/document/rules.ts`, `src/document/ref-kinds.ts` (vystavit klíč reference uvnitř modulu), `src/document/index.ts` (export typu a funkce), `src/remote/feature-types.ts`, `src/remote/testing.ts` (builder popisu s pravidly, je-li potřeba); testy `test/unit/document/rules.test.ts`, `test/unit/remote/feature-types.test.ts`, test editoru featur (`test/unit/interaction/feature-editor*.test.ts` – ten, který dnes ověřuje hlášení u pole).
- **Kontrakt:**

```ts
// src/document/rules.ts – zrcadlo param_rule.hpp a rules.cpp
export type ParamRule = {
  readonly kind: 'disjointRefs';
  readonly code: string;
  readonly param: string;
  readonly other: string;
};
/** Hlášení pravidel; `issues` = výsledek validateAgainstSchema(schema, params). Nikdy nehází. */
export function checkParamRules(
  schema: ParamSchema, rules: readonly ParamRule[], params: unknown, issues: readonly ParamIssue[],
): readonly ParamIssue[];   // jen nová hlášení
```

  - `featureSchemaOf`: `rules` z popisu (`disjointRefs` → `ParamRule`; neznámý nebo prázdný `oneof` → pravidlo se vynechá, žádná chyba – dopředná kompatibilita podle komentáře v proto); `validate: (raw) => { const issues = validateAgainstSchema(frozen, raw); return [...issues, ...checkParamRules(frozen, rules, raw, issues)]; }`. Komentář hlavičky souboru (že vlastní pravidla přijdou jen jako červená featura) upravit.
  - Typ `FeatureSchema` v `document` se nemění (pravidla žijí v uzávěru `validate`).
- **Testy:** `rules.test.ts` se stejnými případy jako `rules_test.cpp`; `feature-types.test.ts` – popis s pravidlem → `validate` vrátí `boolean.sameBody` s `{ index }`, popis s neznámým druhem pravidla → ignorován; editor featur: boolean s tělesem v cílech i nástrojích ukáže hlášení u pole `tools` a nepovolí potvrzení (stejně jako u obecných kódů).
- **Hotovo když:** testy zelené, `npm run typecheck` a `npm run lint:deps` zelené.

### 4. Sdílené případy v obou jazycích

- **Soubory:** nový `test/integration/shared-cases/schema.test.ts`, `test/integration/shared-cases/support/schemas.ts` (beze změny, jen použití), `test/integration/shared-cases/coverage.test.ts`, případně nové `test/shared-cases/schema/validate-*.json` (pravidlo se skrytým nebo rozbitým parametrem, pokud ho boolean umí ukázat; jinak ne), `server/test/shared-cases/schema_cases_test.cpp` jen komentář.
- **Kontrakt (N150 ⚠, mění N124):**
  - Běžec TS čte všechny případy oblasti `schema` (`schema.validate` i `schema.visibleWhen`) nad `builtInSchemas()` ze zlatého souboru, třídí hlášení stejně jako C++ (`issueBefore` v `schema_cases_test.cpp`: `param`, `code`, kanonický JSON `params`, prázdné `params` první). TS třídění zmizelo s M47 (`support/sort.ts`), napsat ho znovu do `support/compare.ts` s vlastním testem.
  - `SERVER_ONLY_CODES = ['sketch.invalidEntity', 'sketch.invalidConstraint']` v běžci: z `expected.ok.issues` se před porovnáním vyřadí hlášení s těmito kódy (klient je neumí a nemá umět). Seznam musí odpovídat spec 03 „Pravidla jen na serveru“.
  - Metatest pokrytí: každé pravidlo (`code`) ze zlatého souboru má aspoň jeden případ `schema.validate`, jehož `expected` ho obsahuje; každý kód ze `SERVER_ONLY_CODES` taky (v C++).
  - `cases:record` se nemění (referencí zůstává C++, N124).
- **Testy:** `npm run test:integration` – všech ~100 případů `schema` zelených v TS; C++ běžec beze změny zelený.
- **Hotovo když:** `npm run check:full` zelený; v hlášení počet případů, které TS běží, a počet vyřazených hlášení (jen skica).

### 5. Specifikace (hlavní sezení)

- [[03-dokument]]: oddíl „Vlastní pravidla“ – `ParamRule` jako data, druh `DisjointRefs`, pravidla jen na serveru (skica).
- [[14-protokol#Schéma featur]]: `rules`, ignorování neznámého druhu.
- [[13-testovani]]: běžec TS `schema`, `SERVER_ONLY_CODES`, upřesnění N124.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_Návrh Clauda (stopa C)._

- Jediné deklarativně popsatelné vlastní pravidlo byl `boolean.sameBody` → druh `DisjointRefs`; `BooleanSchema` přišel o vlastní `validate`, kontrola skici zůstala jen na serveru.
- `FeatureTypeDescriptor.rules` (jen přidané pole), klient vyhodnocuje pravidla stejnými kódy (`src/document/rules.ts`); TS znovu spouští všech 103 případů `schema` (N150) s vyřazením kódů jen pro server.
- Klíč reference v TS nově obsahuje druh (shoda s C++).
- `check` (5813 unit, 332 integračních), `check:server` 1747, `test:e2e` 103 zelené.
