---
type: insight
status: seed
aliases:
  - Render on demand
topics:
  - vykreslování
  - výkon
sources:
  - https://threejs.org/manual/#en/rendering-on-demand
  - https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# Vykreslování na požádání

**Shrnutí:** Statická 3D scéna se nemá kreslit ve smyčce 60 fps. Jeden plánovač, který sloučí všechny požadavky do nejvýš jednoho `requestAnimationFrame`, šetří CPU i baterii, ale mění to, jak se scéna testuje.

## Podrobnosti

- **Plánovač:** `request()` nastaví příznak a naplánuje jeden snímek; další volání do vykreslení nic nedělají. Požadavek během kreslení naplánuje další snímek. Logika je čistá funkce s injektovaným `requestAnimationFrame`, takže se testuje bez prohlížeče.
- **Kdo žádá o snímek:** každý, kdo mění scénu (vrstvy těles, zvýraznění, náhledy), kamera (událost `change` z ovládání) a změna velikosti plátna. Ovládání kamery s doběhem (damping) by potřebovalo smyčku, proto je vypnuté.
- **Důsledek pro testování:** po kliknutí je scéna nakreslená až v dalším snímku. Screenshot pořízený hned potom ukáže předchozí stav, test v prohlížeči proto musí čekat na snímek, ne na událost.
- **Jak ověřit „nekreslí se“:** obalit `requestAnimationFrame` počítadlem na dev stránce. Měření je zvenku, takže nepokřiví API viewportu.

## Jak to využívá tinycad

`FrameScheduler` ve [[09-vykreslovani|spec 09]], ověřeno v [[M08-vykreslovani|M8]]: 0 snímků v nečinnosti i při pohybu myši nad stejnou plochou.

## Zdroje

- three.js manual: Rendering on Demand
- MDN: `requestAnimationFrame`
