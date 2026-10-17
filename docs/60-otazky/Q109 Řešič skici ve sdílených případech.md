---
type: question
status: answered
area: "[[13-testovani]]"
decide_by: "[[M38-zmrazeni-domeny]]"
proposal: "U plně určené skici (DOF 0) porovnávat vyřešené souřadnice s tolerancí, u nedourčené jen splnění vazeb (reziduum) a počet stupňů volnosti."
decision: "DOF 0: souřadnice s tolerancí 1e-6 mm; DOF > 0: stejný DOF a vyřešená skica je pevný bod řešiče (po druhém řešení se nepohne o víc než 1e-6 mm), zaznamenané souřadnice se neporovnávají."
tags:
  - otazka
created: 2026-10-17
updated: 2026-10-17
---
# Q109 Řešič skici ve sdílených případech

**Oblast:** [[13-testovani]], [[12-skicar]], [[Řešič vazeb]] · **Rozhodnout do:** [[M38-zmrazeni-domeny|M38]]

## Otázka

Případy řešiče ze [[Sdílený testovací případ|sdílených případů]] zaznamená planegcs ve WASM, na serveru poběží nativní planegcs ([[Q097 Transakce a undo přes RPC|Q097]]). Algoritmus je stejný, ale jiný překladač a jiné zaokrouhlení mohou u nedourčené skici (zbývají stupně volnosti) dojít k jinému, stejně platnému řešení. Co v případu řešiče porovnat?

## Možnosti a návrh

**A. Podle stupňů volnosti (návrh).** U plně určené skici (DOF 0) je řešení jediné, porovnají se souřadnice s tolerancí 1e-6 mm. U nedourčené se ověří, že každá vazba platí v toleranci (reziduum) a že DOF sedí; souřadnice se neporovnávají.
- \+ Případ neshodí šum řešiče, ale chybu (nesplněná vazba, jiný DOF) ano.
- − U nedourčené skici se neověří, že se body „pohnuly co nejméně“. To dnešní testy také neověřují přesně.

**B. Vždy porovnávat souřadnice.**
- − Křehké u nedourčených skic, které jsou v praxi nejčastější.

**C. Jen reziduum, i u DOF 0.**
- − U plně určené skici je souřadnice nejsilnější důkaz, škoda ji zahodit.

## Rozhodnutí

**Varianta A (Pavel 2026-10-17, podle návrhu Clauda).**

Upřesnění (Pavel 2026-10-17): planegcs v TS vrací jen DOF, reziduum vazeb ne. Platnost vazeb u DOF > 0 se proto ověří jako **pevný bod**: vyřešené entity jdou do řešiče znovu a výsledek se od nich nesmí lišit o víc než `length` a DOF musí zůstat stejný. Když vazby platí, řešič nemá čím hýbat. Nepotřebuje to druhou implementaci vazeb v testech ani v C++.

Upřesnění po revizi architektury M38 (Pavel 2026-10-17, podle návrhu Clauda): samotný pevný bod by nepoznal C++, které tažení ignoruje nebo zahodí pole entit. Při `dof` > 0 se proto porovnají i `entities` bez číselných hodnot a u tažení poloha taženého bodu. Propsáno do [[13-testovani#Sdílené testovací případy]].
