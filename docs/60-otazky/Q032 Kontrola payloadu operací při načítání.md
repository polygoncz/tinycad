---
type: question
status: answered
area: "[[04-operace-a-historie]]"
decide_by: "[[M04-persistence]]"
proposal: "Volitelná metoda handleru validate(raw) volaná z upcastOperation"
decision: "Volitelná metoda handleru validate, volaná z upcastOperation; vestavěné handlery ji mají"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q032 Kontrola payloadu operací při načítání

**Oblast:** [[04-operace-a-historie]] · **Rozhodnout do:** [[M04-persistence]]

## Otázka

`upcastOperation` v M3 kontroluje jen obálku [[Operace|operace]] (`type`, `v`, pole `ops` u dávky). Payload aktuální verze (`featureId` je řetězec, `feature` je platná instance…) nekontroluje. Poškozený [[Operační log|log]] z IndexedDB by pak selhal až při přehrání výjimkou, ne jako `Result` jako u `fromData` ([[Q026 Chyby při načítání dokumentu|Q026]]). Má se payload kontrolovat při načítání, a kde?

## Možnosti a návrh

1. **Volitelná metoda handleru `validate(raw): OperationLoadError[]`**, volaná z `upcastOperation` po upcastu.
   - \+ Tvar zná jen handler; stejný vzor pro operace skicáře.
   - − Další metoda na rozhraní, ruční kontroly tvaru.
2. **Nekontrolovat**, chybu chytit při `replayLog` a převést na chybu načtení.
   - \+ Nic navíc.
   - − Chyba se zjistí pozdě a bez cesty v datech.
3. **Validovat přehráním na kopii** při načítání.
   - − Drahé, neříká, co je špatně.

Návrh: **1**, až to bude potřebovat persistence.

## Rozhodnutí

2026-10-13: **Varianta 1.** `OpHandler` dostane volitelnou metodu `validate(raw)`, kterou `upcastOperation` zavolá na operaci aktuální verze (po případném upcastu). Všech sedm vestavěných handlerů ji implementuje. Persistence ji potřebuje hned, protože data z IndexedDB jsou cizí vstup. Kontroluje se `op` i `inverse` záznamu logu přes novou funkci `parseLogEntry` v `ops`. Propsáno do [[04-operace-a-historie#Přehrání a upcast]] a [[05-persistence#Načtení dokumentu]].
