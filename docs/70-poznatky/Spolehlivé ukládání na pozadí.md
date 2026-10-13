---
type: insight
status: seed
aliases:
  - Autosave
  - At-least-once zápis
topics:
  - persistence
  - zpracování chyb
  - event sourcing
sources:
  - https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB
  - https://developer.chrome.com/docs/web-platform/page-lifecycle-api
  - https://martinfowler.com/eaaDev/EventSourcing.html
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# Spolehlivé ukládání na pozadí

**Shrnutí:** Průběžné ukládání je hlavně práce se selháními: zápis se musí dát bezpečně opakovat a uložený stav nesmí nikdy předběhnout to, co ho pokrývá.

## Podrobnosti

- **At-least-once a idempotence.** Když se fronta po chybě nezahazuje, stejná dávka se může zapsat dvakrát (zápis prošel, ztratila se jen odpověď). Řešením je přirozený klíč (`[docId, seq]`) a `put`: opakování pak dávku přepíše, místo aby ji zdvojilo. Autoincrement klíč by vyráběl duplicity.
- **Atomicita dávky.** Kontroly (mezera v `seq`) a zápis v jedné transakci. Odmítnutá dávka nezapíše nic.
- **Pořadí závislých zápisů.** Odvozená data (snapshot) se ukládají až po datech, ze kterých vznikla (záznamy logu). Úložiště odmítne snapshot „z budoucnosti“, protože po pádu by dal stav, který log nepokrývá.
- **Zpoždění, ne debounce.** Debounce se při plynulém toku změn (tažení) pořád posouvá a neuloží nic. Lepší je, když první změna po klidu naplánuje zápis a další ho neposouvají. Maximální ztráta je pak `flushMs`.
- **Lepivý stav chyby.** Stav `error` zůstane, dokud se zápis nepovede, i když přicházejí nové změny. Jinak by ho přebil `pending` a uživatel by neviděl, že ukládání selhává. Retry s časovačem, aby se uložil i dokument, na kterém se zrovna nepracuje.
- **Nejdřív vlastní stav, pak notifikace.** Výjimka odběratele stavové události nesmí zabránit naplánování dalšího zápisu (viz [[Změna stavu a notifikace odběratelů]]).
- **Zavírání stránky.** `pagehide` a `visibilitychange` (hidden) jsou poslední spolehlivá příležitost k flush. `beforeunload` na mobilu nespolehlivý je.
- **Spojení s úložištěm se může ztratit** (uživatel smaže data webu, upgrade schématu v jiné záložce). Odmítnuté otevření se proto nesmí uložit natrvalo, jinak retry nikdy neuspěje.

## Jak to využívá tinycad

`PersistenceService` a `DocumentStore` v [[05-persistence]], nad [[Operační log|operačním logem]] a [[Snapshot|snapshoty]]. Otevřené zbytky: dvě záložky nad jedním dokumentem ([[Q038 Jeden dokument ve dvou záložkách]]) a pád workeru ([[Q037 Pád workeru a čekající RPC volání]]).

## Zdroje

- MDN: Using IndexedDB (transakce, `onversionchange`).
- Chrome for Developers: Page Lifecycle API (`pagehide`, `visibilitychange`).
- Martin Fowler: Event Sourcing.
