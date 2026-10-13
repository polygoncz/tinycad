---
type: adr
status: accepted
number: 11
aliases:
  - ADR 0011
  - Programování proti rozhraním
  - Vysoká míra abstrakce a modularity
date: 2026-10-13
related:
  - "[[01-architektura]]"
  - "[[0008-hranice-modulu]]"
  - "[[0009-platformove-nezavisla-domena]]"
  - "[[Port a adaptér]]"
  - "[[Kompoziční kořen]]"
supersedes: 
tags:
  - adr
created: 2026-10-13
updated: 2026-10-13
---
# 0011 – Programování proti rozhraním

- **Stav:** Přijato (`status: accepted`)
- **Datum:** 2026-10-13
- **Souvisí:** [[01-architektura]], [[0008-hranice-modulu]], [[0009-platformove-nezavisla-domena]], [[Port a adaptér]], [[Kompoziční kořen]]

## Kontext

Pavel chce jako architektonické kritérium **vysokou míru abstrakce a modularity**: obecná rozhraní i tam, kde druhá implementace v aktuálním plánu není.

Zvažovali jsme i střídmější variantu („pravidlo dvou implementací“: rozhraní jen tam, kde existují nebo jsou v plánu dvě implementace, testovací dvojník se počítá). Pavel zvolil silnější variantu. Aby abstrakce nevznikala nahodile modul od modulu, je potřeba ji uchopit jako **jedno jednotné pravidlo**, které se dá kontrolovat.

Specifikace psané před tímto ADR vystavují konkrétní třídy (`OperationDispatcher`, `Regenerator`, `SelectionModel`, `ToolManager`, `AppSession`…).

## Rozhodnutí

1. **Veřejné API modulu tvoří rozhraní, datové typy a tovární funkce.** `index.ts` exportuje `interface`/`type` a funkce `createXxx(deps): Xxx`. Třídy, které rozhraní implementují, zůstávají uvnitř modulu.
   ```ts
   // ops/index.ts
   export interface OperationDispatcher { dispatch(op: Operation): Result<void, OpError>; readonly events: … }
   export function createOperationDispatcher(deps: { doc: DocumentWriter; handlers: OpHandlerRegistry }): OperationDispatcher;
   ```
2. **Závislosti se předávají jako rozhraní** (konstruktor nebo parametr továrny). Žádný modul nezná konkrétní třídu jiného modulu. Konkrétní implementace propojuje jen [[Kompoziční kořen|kompoziční kořen]] (`app`), a to voláním továren.
3. **Rozhraní jsou úzká a pojmenovaná podle role** (oddělení rozhraní): čtení a zápis zvlášť (`DocumentReader` / `DocumentWriter`), spotřebitel dostane jen to, co potřebuje.
4. **Kompozice místo dědičnosti.** Implementace skládají menší objekty. Dědičnost tříd nanejvýš o jednu úroveň a nikdy přes hranici modulu.
5. **Výjimky, které zůstávají konkrétní:**
   - neměnná data a hodnotové typy (`Vec3`, featury, operace, `Result`) – jsou to data, ne chování,
   - malé utility v `core` (`Emitter`, `ObservableValue`, `DisposableStore`) – stavební kameny bez variability,
   - třídy chyb (`KernelError`) – potřebují `instanceof`.
6. **Modularita** (doplnění [[0008-hranice-modulu|ADR 0008]]): malé veřejné API (exportuje se jen to, co cizí modul potřebuje), rozšíření bez úpravy jádra (nový druh featury, parametru, nástroje = nový soubor a registrace).

Proč tovární funkce, a ne abstraktní třídy (jako v C++): TypeScript má strukturální typování, takže rozhraní nemá runtime cenu a jakýkoli objekt se správným tvarem ho splňuje. Testovací dvojník je pak obyčejný objektový literál. Abstraktní třída by přidala runtime vazbu a svádí k dědičnosti.

## Zvažované alternativy

- **Pravidlo dvou implementací** – méně nepřímosti, ale abstrakce by vznikala jen místy a nerovnoměrně. Pavel chce obecná rozhraní všude.
- **Abstraktní základní třídy místo rozhraní** – známé z C++, ale v TS zbytečná runtime vazba a sklon k hierarchiím.
- **Bez pravidla** – každý modul by se rozhodoval jinak, abstrakce by byla nepředvídatelná.

## Důsledky

- + Každá část jde vyměnit nebo nahradit dvojníkem bez úpravy spotřebitele. Testy nepotřebují mockovací knihovnu.
- + Jednotný tvar API ve všech modulech: kdo zná jeden modul, zná strukturu všech.
- + Hranice modulů jsou ještě ostřejší: ven nejde nic konkrétního.
- − Víc nepřímosti: při čtení kódu se skáče z rozhraní na továrnu a implementaci. „Go to implementation“ v editoru je nutnost.
- − Víc kódu: rozhraní + továrna + implementace u věcí, které mají jedinou implementaci.
- − Riziko abstrakcí, které nesedí: rozhraní navržené bez druhé implementace často zobecňuje špatným směrem. Mírní to pravidlo úzkých rozhraní a ochota rozhraní upravit, když druhá implementace přijde.
- Specifikace psané před tímto ADR se převedou na rozhraní + továrny (viz [[01-architektura#Principy]]).
