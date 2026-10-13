---
type: adr
status: accepted
number: 10
aliases:
  - ADR 0010
  - Prezentační model místo přísného MVP
date: 2026-10-13
related:
  - "[[11-ui]]"
  - "[[10-interakce]]"
  - "[[0009-platformove-nezavisla-domena]]"
  - "[[0006-nemenna-data]]"
supersedes: 
tags:
  - adr
created: 2026-10-13
updated: 2026-10-13
---
# 0010 – Prezentační model místo přísného MVP

- **Stav:** Přijato (`status: accepted`)
- **Datum:** 2026-10-13
- **Souvisí:** [[11-ui]], [[10-interakce]], [[0009-platformove-nezavisla-domena]], [[0006-nemenna-data]]

## Kontext

Zvažovali jsme, jestli UI stavět přísně podle vzoru MVP (Model–View–Presenter). Smysl MVP je logika obrazovky testovatelná bez GUI a tenký pohled. To chceme.

Přísná varianta MVP (pasivní pohled) ale předpokládá toolkit bez data bindingu. Presenter na rozhraní `IView` volá `view.setX()` a pohled nemá žádný stav. Vue funguje obráceně: šablona se deklarativně váže na stav a překresluje se sama. Přísné MVP by ve Vue znamenalo imperativní vrstvu nad deklarativním rendererem a dvě místa se stavem. U viewportu (picking, hover, tažení při 60 fps) se interakce v CAD programech řeší [[Nástroj|nástroji]] se stavovým automatem, ne přes presenter.

## Rozhodnutí

Použijeme **[[Prezentační model|prezentační model]]** (Fowler: *Presentation Model*, ve světě Vue view-model):

1. **Logika obrazovky je v obyčejných TS třídách v `interaction`** (prstenec 2 podle [[0009-platformove-nezavisla-domena|ADR 0009]]): `FeatureTreeModel`, `FeatureEditSession`, `ToolManager`, `SelectionModel`, `ActionRegistry`. Testují se v Node bez DOM.
2. **Jednosměrný tok:** pohled volá *příkazy* prezentačního modelu (`setParam`, `select`, `commit`). Prezentační model mění dokument jen přes operace. Pohled si stav *čte*: presenter do pohledu nikdy nezapisuje.
3. **Jednotný kontrakt nezávislý na frameworku** pro stav, který UI zobrazuje (definuje `core`):
   ```ts
   export interface Observable<T> {
     get(): T;                                // immutable snapshot
     subscribe(fn: () => void): Unsubscribe;
   }
   ```
   Snapshot je [[Neměnná data|neměnný]], změnu tedy pozná porovnání identity (`===`).
4. **Vue komponenty obsahují jen vazby a rozvržení.** Stav dostávají přes composable `useObservable(o)`, který z `Observable` udělá `shallowRef`. Nerozhodují, co se stane.

## Zvažované alternativy

- **Přísné MVP (pasivní pohled)** – stejná testovatelnost, ale pro každou obrazovku navíc rozhraní View, které jde proti Vue a proti formulářům generovaným ze schématu. Hodí se pro toolkity bez bindingu (WinForms, Qt Widgets).
- **Stav v Pinia / Vue reaktivitě** – zamítnuto už v [[0001-jadro-v-cistem-ts|ADR 0001]]: logika by závisela na Vue a nebyla by přenositelná.
- **Bez pravidla, logika volně v komponentách** – nejrychlejší start, ale logika by se netestovala a nepřenesla.

## Důsledky

- + Celá logika obrazovek je přenositelná a testovaná v Node.
- + Kontrakt `get()` + `subscribe()` se mapuje i na React (`useSyncExternalStore`) a Svelte (stores). To je praktický důkaz přenositelnosti.
- + Nový typ featury = nula řádků v UI (formulář ze schématu) i v prezentačním modelu.
- − Každý zobrazovaný stav potřebuje `Observable` a neměnný snapshot. Tvorba snapshotů stojí trochu kódu navíc.
- − Pravidlo „v komponentě jen vazby“ nástroj vynutí jen částečně (importy hlídá dependency-cruiser, zbytek je na review).
