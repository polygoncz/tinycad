---
type: adr
status: accepted
number: 25
aliases:
  - ADR 0025
  - Vstupní stav editované featury
date: 2026-10-15
related:
  - "[[07-regenerace]]"
  - "[[09-vykreslovani]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
  - "[[12-skicar]]"
  - "[[Q075 Vstupní stav editované featury]]"
  - "[[Q076 Rovina a hrany z Prohlížeče do referenčního parametru]]"
  - "[[M21-vstupni-stav-editovane-featury]]"
supersedes:
tags:
  - adr
created: 2026-10-15
updated: 2026-10-15
---
# 0025 – Vstupní stav editované featury

- **Stav:** Přijato (`status: accepted`, Pavel 2026-10-15)
- **Datum:** 2026-10-15
- **Souvisí:** [[Q075 Vstupní stav editované featury|Q075]], [[Q076 Rovina a hrany z Prohlížeče do referenčního parametru|Q076]], [[07-regenerace]], [[09-vykreslovani]], [[10-interakce]], [[M21-vstupni-stav-editovane-featury|M21]]

## Kontext

[[Builder featury|Builder]] vyhodnocuje reference ve **vstupu** featury, tedy ve stavu před ní. Dialog featury, výběr i skicář ale pickují, zvýrazňují a počítají roviny nad **koncovým stavem**. Při editaci je to výstup editované featury, protože lišta stojí hned za ní ([[Revize kódu 2026-10-14]], A1). Projevy:

- Zaoblení: vybraná hrana je zaoblená, takže zmizí a není zvýrazněná. Klik na hranu u nové plochy uloží jméno z výstupu téže featury a featura spadne s `UNRESOLVED_REFERENCE`.
- Skica na ploše: rovina se počítá z koncového stavu. Pozdější Transformace ji posune a pozdější Boolean, který těleso spotřebuje, skicu neotevře.
- Týká se to každé featury, která mění tvar, na který sama odkazuje (shell, úkos, díra).

Stav před featurou už leží v cache `Regeneratoru` (`entries[i-1].state`) a jeho handle jsou živé. Navenek se ale nedostane.

## Rozhodnutí

Dokud je otevřená session dialogu featury (vytvoření i úprava, včetně skicáře), **pickovatelný model je vstup editované featury**. Výsledek featury je jen náhled.

1. **Regenerace vystaví vstup.** `Regenerator.run(studio, { inputOf? })` vrátí v `RegenResult.input` stav před featurou `inputOf` (`{ feature, state }`, nebo `null`, když featura před lištou není). Další výpočet ani tessellaci to nestojí, je to odkaz do cache.
2. **Viewport ukazuje dvě vrstvy.** Hlavní vrstva těles (picking, zvýraznění, skrytí, barvy) dostane tělesa vstupu. Nová **náhledová vrstva** dostane tělesa výsledku, která ve vstupu nejsou se stejným handle (vytvořená nebo změněná featurou). Náhled je průhledný v barvě náhledu palety, nepickuje se a nezvýrazňuje. Obě vrstvy se synchronizují před zveřejněním snapshotu, takže platí D3 z [[M19.1-opravy-z-revize|M19.1]].
3. **Snapshot nese pickovatelná tělesa.** `RegenSnapshot.bodies` zůstává koncový stav (Prohlížeč, export). Nově nese `pick: { feature: FeatureId | null; bodies: readonly RegenBody[] }`. Při otevřené session jsou to tělesa vstupu dané featury, jinak koncový stav. Vybírá je `app`, `interaction` jen čte `snapshot.pick`.
4. **Všechno, co převádí index na jméno, čte `snapshot.pick`:** `refPick`, zvýraznění referencí dialogu, výběr i jeho přemapování. Index z pickingu a jméno tak patří k témuž stavu. Mezistav, kdy je session otevřená, ale `snapshot.pick.feature` ještě není její featura (před první regenerací s posunutou lištou), `refPick` zásahy ignoruje.
5. **Rovina editované skici** je `SketchArtifact.plane`, kterou builder skici spočítal ze svého vstupu. Až když artefakt chybí (skica v chybě), použije se výpočet z reference. Rovinu existující skici jde změnit polem „Rovina“ v panelu skicáře. Pole přepne skicář do výběru roviny přes `refPick` (roviny počátku, rovinné plochy vstupu, řádky rovin v Prohlížeči), Esc výběr ukončí.
6. **Transakce slučuje sousední kroky hned v `applyStep`**, ne až při `commit`. Inverze zůstává z prvního kroku. „Zrušit“ po dlouhém tažení tak nepřehrává tisíce kroků.

Stejně to dělají Onshape a Fusion: při editaci featury je vidět model před ní a výsledek jako náhled.

## Zvažované alternativy

- **B: označit jména vyražená featurou a odmítnout je** ([[Q075 Vstupní stav editované featury|Q075]]): řeší jen samoreferenci. Zvýraznění vybraných hran dál mizí a rovina skici se dál bere z koncového stavu.
- **Výsledek pevně, vstup jen jako obrys:** výsledek vypadá „hotově“, ale klikání do hran vstupu přes pevné plochy výsledku je méně zřetelné (Pavel 2026-10-15).
- **Výběr během dialogu zakázat:** bezpečné, ale omezuje uživatele. Jeden invariant „pickuje se vstup“ je jednodušší (Pavel 2026-10-15).
- **Přepsat `snapshot.bodies` na vstup:** změnil by se i Prohlížeč a export. Samostatné pole `pick` drží koncový stav tam, kde ho UI potřebuje.

## Důsledky

- (+) Picking, zvýraznění a builder pracují nad stejným stavem. Zmizí celá třída chyb se samoreferencí, a to i pro budoucí featury (shell, úkos, díra).
- (+) Vybrané hrany zaoblení jsou vidět a jsou zvýrazněné.
- (+) Rovina skici přežije pozdější Transformaci i Boolean.
- (−) Během editace se tesselují dvě sady těles. Vstup se při tažení parametru nemění, takže ho drží cache sítí podle handle.
- (−) `render` má druhou vrstvu těles se stejnými `BodyId`, takže skrytí a barvy se musí použít na obě.
- (−) Těleso, které featura spotřebuje (Boolean), je během editace vidět pevně ze vstupu a ve výsledku chybí. Náhled tak ukáže jen to, co featura vytvoří nebo změní.
