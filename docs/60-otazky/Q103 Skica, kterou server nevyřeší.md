---
type: question
status: answered
area: "[[14-protokol]]"
decide_by: "[[M44.1-builder-skici-na-serveru]]"
proposal: "Když nativní planegcs skicu z feature.setParams nevyřeší, server operaci odmítne (SKETCH_NOT_SOLVED) a dokument se nezmění; klient ponechá lokální stav a ukáže chybu."
decision: "Server operaci odmítne (FAILED_PRECONDITION, SKETCH_NOT_SOLVED), dokument se nezmění, klient ponechá lokální skicu a ukáže chybu; vyřešenou skicu server uloží vždy ve svém řešení a klient ho převezme bez tolerance."
tags:
  - otazka
created: 2026-10-17
updated: 2026-10-17
---
# Q103 Skica, kterou server nevyřeší

**Oblast:** [[14-protokol]], [[12-skicar]], [[Q094 Nativní jádro na serveru přes gRPC|Q094]] · **Rozhodnout do:** [[M44.1-builder-skici-na-serveru|M44.1]] (původně M44, rozděleno 2026-10-17)

## Otázka

Server je autorita nad [[Skica|skicou]]: při každém `Apply` se `setParams` skici ji znovu vyřeší nativním [[Řešič vazeb|řešičem]] ([[Q097 Transakce a undo přes RPC|Q097]]). Co když řešič na serveru skicu nevyřeší (nekonverguje, vazby jsou ve sporu), ačkoli klient ji vyřešil? A co když ji vyřeší s jinými souřadnicemi?

## Možnosti a návrh

**A. Odmítnout operaci (návrh).** RPC skončí `FAILED_PRECONDITION` s `SKETCH_NOT_SOLVED` a `issues`. Dokument se nezmění, klient ponechá lokální skicu a ukáže chybu. Při odlišných souřadnicích platí serverové a klient je převezme z read modelu.
- \+ Do dokumentu se nikdy nezapíše skica, kterou server neumí vyřešit. Přehrání logu je pak bezpečné.
- − Uživatel může „uvíznout“ s tažením, které klient povolil a server ne. Mělo by to být vzácné, protože oba běží týž planegcs.

**B. Uložit, co poslal klient, a skicu označit varováním.**
- \+ Uživatel nic neztratí.
- − Server přestává být autorita, do logu se dostane nevyřešená skica.

**C. Uložit poslední vyřešený stav serveru.**
- − Tiše zahodí, co uživatel udělal.

Detail k rozhodnutí v M44: jakou toleranci má mít „jiné souřadnice“, aby klient při každém puštění myši neposkočil o šum v posledním desetinném místě.

## Rozhodnutí

**Varianta A, bez tolerance (Pavel 2026-10-17, podle návrhu Clauda).**

- Nevyřešená skica: `Apply` (i `Dispatch`) se `setParams` skici skončí `FAILED_PRECONDITION` s `ErrorDetail { reason: SKETCH_NOT_SOLVED, issues: [{ param: 'sketch', code: 'sketch.notSolved' }] }`. Dokument, transakce i log zůstanou beze změny. Klient ponechá lokální skicu a ukáže chybu (klíč `sketch.notSolved` v `messages` skicáře).
- Vyřešená skica: server uloží **vždy svůj** výsledek a klient převezme souřadnice z read modelu, bez prahu tolerance. Rozdíl v řádu 1e-9 mm není vidět, takže skica neposkakuje, a platí jedno pravidlo: platná data jsou serverová.

Propsáno do [[14-protokol#Změny dokumentu]] a [[M44.1-builder-skici-na-serveru]] (po rozdělení M44 2026-10-17).
