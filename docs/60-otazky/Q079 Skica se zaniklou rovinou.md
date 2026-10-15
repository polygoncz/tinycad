---
type: question
status: answered
area: "[[12-skicar]]"
decide_by: "[[M21-vstupni-stav-editovane-featury]]"
proposal: "Skica bez roviny se otevře na rovině XY s hláškou a aktivním polem Rovina, aby šla přepojit"
decision: "Varianta A: otevřít na rovině XY s hláškou a aktivním výběrem roviny (Pavel 2026-10-15)"
tags:
  - otazka
created: 2026-10-15
updated: 2026-10-15
---
# Q079 Skica se zaniklou rovinou

**Oblast:** [[12-skicar]] · **Rozhodnout do:** [[M21-vstupni-stav-editovane-featury]]

## Otázka

Skica na ploše tělesa (`TopoRef`) přijde o rovinu, když plocha ve vstupu skici zanikne (například se změní nebo smaže featura před ní). Builder pak skončí chybou a skica nemá artefakt. `SketchEditor.edit` rovinu nespočítá ani z artefaktu (`planeOfSketch`), ani z reference (`resolvePlane`), a vyhodí výjimku ([[12-skicar#Roviny a počátek]]).

Pole „Rovina“ v panelu skicáře z [[M21-vstupni-stav-editovane-featury|M21]] ([[0025-vstupni-stav-editovane-featury|ADR 0025]]) je přitom přesně nástroj, kterým by šla skica přepojit na jinou rovinu. Dostat se k němu ale nejde, protože se skicář neotevře. Na tohle upozornila architektonická revize M21.

## Možnosti a návrh

| Varianta | Pro | Proti |
|---|---|---|
| **A: otevřít na rovině XY s hláškou a aktivním polem Rovina.** Panel ukáže „Rovina chybí, vyberte novou“, výběr roviny je hned aktivní. | skica jde opravit bez ztráty entit, jako v Onshape | entity se dočasně ukážou na XY, než se rovina vybere |
| B: neotevírat, ale nabídnout akci „Změnit rovinu skici…“ v kontextovém menu | skicář se nikdy neotevře na „nesprávné“ rovině | další cesta k témuž poli, víc UI |
| C: nechat výjimku, skicu jde jen smazat | žádná práce | uživatel ztratí skicu |

Návrh: **A**.

## Rozhodnutí

**2026-10-15, Pavel:** varianta A, ještě v [[M21-vstupni-stav-editovane-featury|M21]] (úkol Ú8).

_(Až se rozhodne: vyplnit sem, nastavit `status: answered` a `decision`, rozhodnutí propsat do specifikace. Zásadní rozhodnutí → nové ADR.)_
