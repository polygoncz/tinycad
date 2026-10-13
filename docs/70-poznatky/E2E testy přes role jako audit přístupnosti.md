---
type: insight
status: seed
aliases:
  - getByRole
  - Testy přes přístupné názvy
topics:
  - testování
  - přístupnost
  - UI
sources:
  - https://playwright.dev/docs/locators
  - https://testing-library.com/docs/queries/about/#priority
  - https://www.w3.org/WAI/ARIA/apg/
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# E2E testy přes role jako audit přístupnosti

**Shrnutí:** Když e2e test hledá prvky jen přes role a přístupné názvy (`getByRole('textbox', { name: 'Výška' })`), najde je jen tehdy, když je najde i čtečka obrazovky – test tak zároveň hlídá přístupnost.

## Podrobnosti

- Selektory podle tříd nebo `data-testid` projdou i u UI, které čtečka nepřečte. Role a přístupný název ne: chybějící `<label>`/`aria-labelledby`, stav jen barvou nebo glyf ikony v názvu tlačítka test hned odhalí.
- Typické opravy: `aria-labelledby` s `useId()` (když `<label>` nejde vnořit), `aria-hidden` na ikonových fontech, stav do `aria-describedby`, `aria-invalid` u chybného pole, fokus prvního pole po otevření dialogu.
- **Co unit testy nevidí:** rozložení a životní cyklus v prohlížeči. Ruční průchod a e2e našly přetékající `<input>` (grid sloupec `1fr` má minimum podle obsahu, oprava `minmax(0, 1fr)`) a zámek dokumentu držený po hot reloadu.
- E2E proti produkčnímu buildu (`vite preview`) s nainstalovaným prohlížečem (`channel: 'chrome'`) nic nestahuje a ověřuje i to, že build obsahuje workery a WASM.

## Jak to využívá tinycad

`e2e/smoke.spec.ts` ([[M10-ui]], Playwright); pravidla přístupnosti v [[11-ui]], sekce Komponenty.

## Zdroje

- Playwright: Locators (doporučené pořadí, `getByRole` první).
- Testing Library: Priority of queries.
- WAI-ARIA Authoring Practices Guide.
