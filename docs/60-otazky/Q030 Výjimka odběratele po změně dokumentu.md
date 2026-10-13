---
type: question
status: open
area: "[[04-operace-a-historie]]"
decide_by: "[[M03-operace]]"
proposal: "Dispečer zapíše operaci do logu i při výjimce odběratele, výjimku pak pošle dál"
decision: ""
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q030 Výjimka odběratele po změně dokumentu

**Oblast:** [[04-operace-a-historie]] · **Rozhodnout do:** [[M03-operace]]

## Otázka

Mutátor [[Dokument|dokumentu]] nejdřív provede změnu a pak vyšle `changed` ([[03-dokument|spec 03]]). Když některý odběratel vyhodí výjimku, `Emitter` zavolá ostatní a výjimku pošle dál – mutátor tedy skončí výjimkou, **ačkoli je dokument už změněný**. Upozornil na to `architecture-reviewer` při revizi [[M02-dokument|M2]].

Spec [[04-operace-a-historie|04]] říká: „výjimka v `apply` nezapíše záznam“. Kdyby dispečer bral výjimku odběratele jako selhání `apply`, dokument by se změnil, ale v logu by změna chyběla – undo i persistence by se rozešly se stavem dokumentu. Jak to má dispečer rozlišit?

## Možnosti a návrh

1. **Zapsat a výjimku poslat dál.** Dispečer odliší selhání handleru (dokument se nezměnil – porovná `doc.studio` a `doc.meta` před a po identitou) od výjimky po změně. Při změně zapíše záznam do logu a teprve pak výjimku vyhodí.
   - \+ Log vždy odpovídá dokumentu. + Chyba odběratele se neztratí.
   - − Dispečer musí porovnávat stav; jedno pravidlo navíc.
2. **Dokument chyby odběratelů zachytí** a nahlásí je jinudy (např. vlastní událost `error` nebo callback z `app`).
   - \+ Mutátor vyhodí výjimku jen při skutečném selhání.
   - − Dokument musí vědět, kam chyby hlásit (`core` nic neloguje, [[Q022 Platformové typy v core|Q022]]).
3. **Odběratelé nesmějí házet** (pravidlo + review).
   - − Pravidlo, které nehlídá kompilátor.

Návrh: **1**. Pravidlo „log vždy odpovídá dokumentu“ je pro undo a persistenci zásadní a porovnání identitou je díky [[Neměnná data|neměnným datům]] levné.

## Rozhodnutí

_(Až se rozhodne: vyplnit sem, nastavit `status: answered` a `decision`, rozhodnutí propsat do specifikace. Zásadní rozhodnutí → nové ADR.)_
