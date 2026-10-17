---
type: question
status: answered
area: "[[04-operace-a-historie]]"
decide_by: "[[Roadmapa]]"
proposal: "Transakce i undo žijí v sezení na serveru; RPC kopírují dnešní rozhraní Transaction (Begin, Apply, ApplyTransient, Commit, Abort) a UndoManager (Undo, Redo)."
decision: "Transakce i undo v sezení na serveru, RPC 1:1 podle Transaction a UndoManager, operation_id u každého Apply; server znovu řeší skicu při každém Apply, ne až při Hotovo."
tags:
  - otazka
created: 2026-10-17
updated: 2026-10-17
---
# Q097 Transakce a undo přes RPC

**Oblast:** [[04-operace-a-historie]], [[10-interakce]], [[Q094 Nativní jádro na serveru přes gRPC|Q094]] · **Rozhodnout do:** [[Roadmapa|plánování série nativního jádra]] (po M37)

## Otázka

Dnes [[Transakce|transakce]] aplikuje operace hned (náhled, regenerace), ale do [[Operační log|logu]] zapíše jeden záznam až při `commit`. Drží ji jen `FeatureEditor` a `SketchEditor` ([[Q069 Smí nástroj otevřít vlastní transakci|Q069]]): dialog featury, tažení manipulátoru a celá editace skici od vstupu do „Hotovo“. Umí přechodné kroky (`applyTransient`, posun rollback baru) a slučuje sousední `setParams` už při `apply`.

[[Undo a redo]] nemaže historii, připíše inverzní operaci jako nový záznam a zásobníky se počítají z logu.

Po rozdělení dokument, log i regenerace žijí na serveru (Q094). Kde bude otevřená transakce a kde zásobník undo?

## Možnosti a návrh

**A. Transakce i undo v sezení na serveru (návrh).** RPC 1:1 kopírují dnešní rozhraní: `BeginTransaction(label)`, `Apply(op)`, `ApplyTransient(op)`, `Commit`, `Abort`, `Undo`, `Redo`. Každé `Apply` nese vlastní `operation_id` (zásada idempotence z Q094).
- \+ Náhled potřebuje regeneraci a ta je na serveru, takže server operace tak jako tak aplikovat musí. Transakce je jen stav, který k tomu patří.
- \+ Undo je už dnes jen další záznam v logu a zásobníky se z logu počítají. Na serveru je to přirozené a klient zná jen `canUndo`/`canRedo` z read modelu.
- \+ Výpadek spojení transakci nezruší, protože žije v sezení (zásada sezení ≠ spojení). Timeout nečinnosti sezení otevřenou transakci zahodí jako `abort`.
- − Každé `setParam` v dialogu je síťové volání. Nevadí, protože náhled bez regenerace stejně nevznikne.

**B. Transakce v klientovi, server bezstavový pro náhled.** Klient sbírá operace a pro náhled posílá `Preview(ops)`. Server je aplikuje na kopii dokumentu, zregeneruje a zahodí. Při `commit` klient pošle sloučenou dávku jako jednu operaci.
- \+ Server nemá stav transakce, `ApplyOperation` zůstane jediná zapisující metoda.
- − Každý náhled znovu aplikuje celou rozpracovanou dávku od základního stavu. U dlouhé editace skici je to zbytečně drahé.
- − Slučování a přechodné kroky by se musely napsat v TS i v C++.

**C. Bez transakcí, každá operace rovnou do logu.** Komprese až dodatečně na serveru.
- − Popírá [[0005-operacni-log|ADR 0005]] i dnešní spec 04 (stovky záznamů za jedno tažení), zpětná komprese logu je složitější než transakce.

**Návaznost na skicu ([[Q094 Nativní jádro na serveru přes gRPC|Q094]] bod 1):** při variantě A je editace skici dlouhá transakce na serveru. Klient táhne lokálně a do transakce posílá `setParams` skici při puštění myši. Server ji znovu vyřeší nativním řešičem. „Potvrzení úpravy“ z Q094 je tedy každé `Apply`, ne až „Hotovo“. Je potřeba potvrdit, že to tak Pavel myslel.

Návrh: **A**. Rozhraní se nemění, jen se přestěhuje. Dnešní testy transakcí a undo poslouží jako specifikace C++ verze i jako testy přes gRPC.

## Rozhodnutí

**Varianta A (Pavel 2026-10-17, podle návrhu Clauda).** Otevřená transakce i undo žijí v sezení na serveru. RPC kopírují dnešní rozhraní `Transaction` a `UndoManager`: `BeginTransaction(label)`, `Apply`, `ApplyTransient`, `Commit`, `Abort`, `Undo`, `Redo`. Každé `Apply` nese vlastní `operation_id`. Výpadek spojení transakci nezruší. Timeout nečinnosti sezení ji zahodí jako `abort`. Klient zná z read modelu jen `canUndo`, `canRedo` a stav transakce.

**Upřesnění Q094 bod 1 (Pavel 2026-10-17):** „potvrzení úpravy“ je **každé `Apply`** se `setParams` skici, tedy typicky puštění myši po tažení, ne až „Hotovo“. Server skicu v tu chvíli znovu vyřeší nativním planegcs a regeneruje s jeho výsledkem. Náhled 3D těles tak vždy stojí na skice ověřené serverem.

Do specifikací ([[04-operace-a-historie]], [[10-interakce]], [[12-skicar]]) se to propíše při plánování série nativního jádra.
