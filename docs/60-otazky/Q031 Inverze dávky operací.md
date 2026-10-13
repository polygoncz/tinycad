---
type: question
status: answered
area: "[[04-operace-a-historie]]"
decide_by: "[[M03-operace]]"
proposal: "Dávku zpracuje dispečer sám a inverze sbírá postupně po podoperacích"
decision: "Možnost 1: batch zpracuje dispečer, inverze sbírá postupně po podoperacích"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q031 Inverze dávky operací

**Oblast:** [[04-operace-a-historie]] · **Rozhodnout do:** [[M03-operace]]

## Otázka

[[Handler operace|Handler]] počítá inverzi metodou `invert(doc, op)` **před** `apply`, z aktuálního stavu [[Dokument|dokumentu]]. U `batch` to nejde: inverze druhé podoperace závisí na stavu *po* první (např. `feature.add` a hned `feature.setParams` téže featury – před aplikací featura ještě neexistuje, takže staré parametry nejsou k přečtení). Navíc každá podoperace může posunout [[Rollback bar|rollback bar]] a inverze ho musí obnovit ([[Q029 Posun rollback baru při změnách featur|Q029]]). Kdo a jak má inverzi dávky spočítat?

## Možnosti a návrh

1. **Dávku zpracuje dispečer.** `batch` nemá doménový handler; dispečer (a [[Transakce|transakce]]) při aplikaci dávky rekurzivně projde podoperace, u každé zavolá `invert` → `apply` a obalí inverzi obnovou rollback baru. Inverze dávky = `batch` sebraných inverzí v opačném pořadí.
   - \+ Rozhraní `OpHandler` zůstane beze změny. + Jedno místo pro „obecná“ pravidla (rollback bar, dávka).
   - − `batch` je výjimka z „každý typ má handler“; registr ho nesmí obsahovat.
2. **`batch.invert` nasimuluje dávku na dočasné kopii dokumentu.**
   - \+ Žádná výjimka v dispečerovi.
   - − Handler potřebuje vytvořit `DocumentWriter` (kopii) – `ops` by tvořil dokumenty; dávka se aplikuje dvakrát.
3. **Změnit kontrakt na `apply(doc, op): Operation`** – `apply` vrací inverzi.
   - \+ Žádné dvojí čtení stavu, přirozené pro dávku.
   - − Míchá výpočet inverze s mutací; rozbíjí čisté pořadí „invert → apply“ a test „invert bez změny dokumentu“.

Návrh: **1**. `batch` je strukturální operace, ne doménová, a dispečer už inverzi obaluje kvůli rollback baru – obojí patří na jedno místo.

## Rozhodnutí

2026-10-13: **možnost 1.** `batch` nemá handler v registru; aplikaci operace (včetně dávky a obalení inverze obnovou rollback baru) dělá jedna interní funkce dispečera, kterou sdílí `dispatch`, transakce i přehrání logu. Propsáno do [[04-operace-a-historie#Dávka]].
