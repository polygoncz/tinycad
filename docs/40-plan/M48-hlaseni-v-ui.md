---
type: milestone
status: done
order: 48
aliases:
  - M48
  - M48 Hlášení v UI
modules:
  - app
  - ui
  - interaction
specs:
  - "[[11-ui]]"
  - "[[10-interakce]]"
  - "[[14-protokol]]"
depends_on:
  - "[[M47-uklid-a-dokonceni]]"
started: 2026-10-17
finished: 2026-10-17
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M48 – Hlášení v UI

**Cíl:** Klient má kanál dočasných hlášení (`AppSession.notices`) a toast, takže uživatel uvidí ztrátu transakce, zamítnutou skicu, odmítnutou změnu a výpadek serveru (N134). Dnes to všechno končí v `console.error` (`reportError` v `app/remote-session.ts`), což navíc shodí každý e2e test (fixture hlídá konzoli).

> Upřesněno 2026-10-17 (plánovač, [[Rozhodnutí nativního jádra#Plány M48–M51 (po nativním jádře)|N151–N153]]). Stopa B; [[M52-tenky-klient|M52]] staví na kanálu hlášení, proto zdroje hlášení nesmí záviset na optimistickém zrcadle.

**Specifikace:** [[11-ui]] (kontrakt `AppSession`, komponenty), [[10-interakce]] (export souboru), [[14-protokol]] (ztráta transakce, stavy spojení)

**Navazuje na:** [[M47-uklid-a-dokonceni]]

## Úkoly

- [x] 1. Kanál hlášení v `app`: `createNoticeCenter`, `noticeOfRefusal`, `AppSession.notices` a `dismissNotice`.
- [x] 2. Zdroje hlášení: ztracená transakce, odmítnutá a zahozená změna (včetně `SKETCH_NOT_SOLVED` a `READ_ONLY`), server nedostupný a obnovené spojení; `reportError` je už jen pro neočekávané chyby.
- [x] 3. Toast v `ui`: `ToastStack.vue` pro hlášení sezení i pro dnešní toast chyby zavření v `App.vue`, přístupnost, překlady.
- [x] 4. Úklid stavů, které serverová cesta nenastaví (N144): `RegenUiState.failed`, `KernelUiState 'failed'`, varování „export bez historie“.
- [x] 5. E2E: restart jádra uprostřed dialogu ukáže hlášení o ztracené transakci (samostatný sériový projekt Playwright).
- [x] 6. Spec 10, 11 a 14 a deník (hlavní sezení).

## Akceptační kritéria

- Ztracená transakce, zamítnutá skica, odmítnutá změna a výpadek serveru jsou vidět v UI jako toast, ne v konzoli; e2e fixture hlídající `console.error` nic nevypíná.
- Zdroje hlášení čtou jen `RemoteSession` (`events`, `connection`) a odmítnutí serveru přes `noticeOfRefusal` – nic ze `MirrorDocument` (příprava na [[M52-tenky-klient|M52]]).
- V typech `app` a `ui` nezůstal stav, který nic nenastavuje (N144).
- `npm run check` a `npm run test:e2e` (včetně projektu `restart`) zelené.

## Co se naučíš

Jak oddělit dočasná hlášení (událost, která za chvíli zmizí) od trvalého stavu UI (Observable, který platí, dokud se nezmění) a jak je napojit na asynchronní události ze serveru.

## Implementační plán

Úkoly 1–5 = jedno spuštění subagenta `implementer` (Opus), v pořadí 1 → 5. Úkol 6 dělá hlavní sezení. Pro všechny:

- **Testy po větších celcích (N2):** během úkolů cílené `npx vitest run test/unit/app test/unit/ui`, `npm run typecheck`, `npm run lint:deps`; celý `npm run check` na konci úkolů 3 a 4; e2e jen v úkolu 5 (`npm run test:e2e -- m48` a projekt `restart`).
- **Nic ze zrcadla:** nový kód v `app` nesmí importovat `MirrorDocument` ani `remote-dispatcher.ts` (kromě úpravy volání `onError`/`onLost` v `remote-session.ts`).
- **Název:** typ `TitleBarNotice` v `ui/title-bar-status.ts` už slovo „notice“ používá pro trvalé stavy titulku; nový typ se jmenuje `AppNotice` a pole `notices`, ať se nepletou.

### 1. Kanál hlášení (`app/notices.ts`)

- **Soubory:** nový `src/app/notices.ts`, `src/app/app-session.ts` (typ), `src/app/index.ts` (export typů), `src/app/remote-session.ts` (vytvoření centra, pole fasády), `src/app/browser.ts` jen pokud fasádu přebaluje výčtem polí; testy `test/unit/app/notices.test.ts`.
- **Kontrakt:**

```ts
// src/app/notices.ts
export type NoticeKind = 'info' | 'warning' | 'error';
export type NoticeParams = Readonly<Record<string, string | number>>;

/** Jedno dočasné hlášení; neměnné. */
export interface AppNotice {
  /** Rostoucí číslo v rámci sezení (klíč pro Vue a dismiss). */
  readonly id: number;
  readonly kind: NoticeKind;
  /** Klíč překladu ('notice.transactionLost', 'sketch.notSolved'); text dělá ui (ADR 0014). */
  readonly key: string;
  readonly params: NoticeParams;
  /** true = zůstane, dokud ho uživatel nezavře nebo ho zdroj neodvolá (dismissKey). */
  readonly sticky: boolean;
}

export interface NoticeInput {
  readonly kind: NoticeKind;
  readonly key: string;
  readonly params?: NoticeParams;
}

/** Trvání podle druhu; null = sticky. */
export const NOTICE_DURATION_MS: Readonly<Record<NoticeKind, number | null>>; // { info: 4000, warning: 8000, error: null }
/** Nejvýš tolik hlášení najednou; nejstarší vypadne. */
export const MAX_NOTICES = 3;

export interface NoticeCenter extends Disposable {
  readonly notices: Observable<readonly AppNotice[]>;
  show(input: NoticeInput): void;
  /** Neznámé id: nic. */
  dismiss(id: number): void;
  /** Odvolá všechna hlášení s tímto klíčem (obnovené spojení odvolá „server nedostupný“). */
  dismissKey(key: string): void;
}
export function createNoticeCenter(): NoticeCenter;

/**
 * Odmítnutí změny serverem → hlášení, nebo null, když ho ukazuje jiný kanál.
 * Jediné místo, které z chyby dělá hlášení; M52 ho volá ze svého dispečeru beze změny.
 */
export function noticeOfRefusal(error: unknown): NoticeInput | null;
```

- **`AppSession`** (`app-session.ts`) dostane dvě pole: `readonly notices: Observable<readonly AppNotice[]>` a `dismissNotice(id: number): void`.
- **Invarianty a krajní případy:**
  - `show` se stejným `key` a stejnými `params` (porovnání JSON) jako viditelné hlášení ho **nahradí** novým `id` na konci seznamu a časovač začne znovu (žádné duplikáty při opakované chybě).
  - Nad `MAX_NOTICES` vypadne nejstarší (i sticky).
  - Časovač: `setTimeout`/`clearTimeout` z `globalThis` (`app` není prstenec 1, časovače smí); `dismiss`, `dismissKey`, nahrazení a `dispose` svůj časovač zruší. Po `dispose` je `show` no-op a seznam prázdný.
  - Seznam je zmrazené pole; každá změna = nové pole (Observable porovnává `Object.is`).
- **`noticeOfRefusal` – tabulka:**

| Chyba | Hlášení |
|---|---|
| `RemoteError` s `reason === 'SKETCH_NOT_SOLVED'` | `warning`, `sketch.notSolved` (klíč už existuje) |
| `RemoteError` s `reason === 'READ_ONLY'` | `error`, `notice.readOnly` (N146: karta bez zámku aspoň řekne proč) |
| `RemoteError`, pro který `isRetryable` (`remote`) platí | `null` – výpadek ukazuje titulek a hlášení o spojení (N92) |
| jiný `RemoteError` | `error`, `notice.changeRejected`, `{ reason: error.reason ?? error.code }` |
| cokoli jiného (`Error` „nepotvrzená změna už nejde použít“) | `warning`, `notice.changeDropped` |

- **Testy (`notices.test.ts`, `vi.useFakeTimers`):** show/dismiss/dismissKey; info zmizí po 4 s, warning po 8 s, error zůstane; nahrazení stejného hlášení (nové id, jeden prvek, nový časovač); limit 3; dispose zruší časovače; každý řádek tabulky `noticeOfRefusal`.
- **Hotovo když:** testy zelené, `AppSession` má obě pole, `typecheck` zelený (fasáda vrací centrum, zatím bez zdrojů).

### 2. Zdroje hlášení (`app/notice-sources.ts`)

- **Soubory:** nový `src/app/notice-sources.ts`, `src/app/remote-session.ts`; testy `test/unit/app/notice-sources.test.ts`, úprava `test/unit/app/remote-session.test.ts` (případy `:249` ztracená transakce, `:290` změna vzdaná offline) a `test/unit/app/remote-dispatcher.test.ts` jen tam, kde test čte konzoli.
- **Kontrakt:**

```ts
// src/app/notice-sources.ts
/**
 * Napojí hlášení na sezení jádra: událost 'lost' → transactionLost; přechody stavu spojení.
 * Vrací funkci, která vše odpojí (lifetime sezení).
 */
export function connectNoticeSources(session: Pick<RemoteSession, 'events' | 'connection'>, notices: NoticeCenter): Unsubscribe;
```

| Zdroj | Kde dnes | Hlášení |
|---|---|---|
| `session.events` `'lost'` (`remote/session.ts`, nový epoch sezení s rozpracovanou transakcí) | `onLost` v `remote-session.ts:198` → `console.error` | `warning`, `notice.transactionLost`. `onLost` dispečeru dál jen zavře dialog (`features.current.get()?.cancel()`), konzoli nevolá. |
| přechod `connection` do `'offline'` (retrier to vzdal) | jen titulek | `error` sticky, `notice.serverUnavailable` |
| přechod z `'offline'` do `'online'` | jen titulek | `dismissKey('notice.serverUnavailable')` + `info`, `notice.connectionRestored` |
| `onError` dispečeru (odmítnutá odpověď i nepotvrzená změna, která už nejde použít) | `remote-session.ts:193` → `connection.changeDropped` + `console.error` | `connection.changeDropped(error)` zůstává; místo `reportError` `noticeOfRefusal(error)` → `show`, když není `null` |

  - `'retrying'` ani `'connecting'` hlášení nedělá (titulek ukazuje „obnovuji spojení“; krátký výpadek nemá blikat toastem). Přechod `'retrying'` → `'online'` bez `'offline'` mezi nimi nic neukáže.
  - První `'connecting'` → `'online'` po otevření nic neukáže.
  - `reportError` (= `console.error`) zůstává pro neočekávané chyby: `close()`, `noteFailure`, chyby odběratelů v `read-model-view`, `retryKernel`. Z výčtu zdrojů už do konzole nejde nic.
- **Proč tady a ne v dispečeru:** `events` a `connection` patří `RemoteSession`, který M52 zachová; odmítnutí jde přes jednu funkci `noticeOfRefusal`, kterou M52 zavolá ze svého tenkého dispečeru. Zrcadlo tak může zmizet, aniž se hlášení přepisují.
- **Testy:** falešný `RemoteSession` (`src/remote/testing.ts`) a falešné jádro `createFakeCore()`: (a) `SESSION_NOT_FOUND` při `apply` uprostřed dialogu → dialog zavřen a jedno hlášení `notice.transactionLost`, konzole čistá (`vi.spyOn(console, 'error')` nevolán); (b) odpověď `SKETCH_NOT_SOLVED` na `feature.setParams` skici → hlášení `sketch.notSolved`, lokální vrstva zůstává (dnešní chování N63); (c) `READ_ONLY` → `notice.readOnly`; (d) `INVALID_OPERATION` → `notice.changeRejected` s `reason`; (e) offline → sticky `serverUnavailable`, pak online → zmizí a přijde `connectionRestored`; (f) `retrying` → `online` nic; (g) změna vzdaná offline (N92) → žádné hlášení z `onError` (jen titulek a `serverUnavailable`).
- **Hotovo když:** testy zelené, `rg -n "reportError\(new Error\('The open transaction" src` nic, `onError` nevolá `reportError`.

### 3. Toast v `ui`

- **Soubory:** nové `src/ui/components/ToastStack.vue`, `src/ui/toasts.ts` (čistý presenter); upravit `src/ui/components/AppShell.vue` (hlášení sezení), `src/ui/App.vue` (chyba zavření dokumentu přes `ToastStack`, CSS `.toast` přesunout do komponenty), `src/ui/i18n/{cs,en}.ts`; testy `test/unit/ui/toasts.test.ts`, `test/unit/ui/components/ToastStack.test.ts` (SSR `renderToString` jako `SketchGlyphs.test.ts`), `test/unit/ui/i18n/i18n.test.ts` (povinné klíče), `test/unit/ui/document-switcher.test.ts` jen když se změní markup chyby zavření.
- **Kontrakt:**

```ts
// src/ui/toasts.ts
export interface ToastItem {
  readonly id: string;               // 'notice-12', 'close-error'
  readonly tone: 'info' | 'warning' | 'error';
  readonly text: string;             // už přeložený
}
/** Hlášení sezení → položky toastu; text = t(key, params). */
export function toastItemsOf(notices: readonly AppNotice[], t: (key: string, params: NoticeParams) => string): readonly ToastItem[];
```

  - `ToastStack.vue`: `props: { items: readonly ToastItem[] }`, `emits: { dismiss: (id: string) => true }`. Kontejner vpravo dole nad stavovým řádkem (dnešní pozice `.toast` v `App.vue`), položky pod sebou, nejnovější dole.
  - **Přístupnost:** položka `error` má `role="alert"`, ostatní `role="status"`; tlačítko zavření `<button type="button" :aria-label="t('app.dismiss')">` s ikonou `x` (Tabler); barva podle tónu z tokenů tématu, ne jen barvou (ikona tónu `info-circle`/`alert-triangle`/`alert-circle`). Žádné zachytávání fokusu.
  - `AppShell.vue`: `useObservable(session.notices)` → `toastItemsOf` → `ToastStack`, `dismiss` → `session.dismissNotice(Number(id.slice(7)))` (nebo mapa id → číslo v presenteru; implementátor zvolí jednodušší a popíše v hlášení).
  - **Klíče překladu (cs, en):** `notice.transactionLost` („Server přerušil rozpracovanou úpravu. Dialog se zavřel a změna se neuložila.“), `notice.serverUnavailable` („Server je nedostupný. Změny se neukládají.“), `notice.connectionRestored` („Spojení se serverem je obnovené.“), `notice.readOnly` („Dokument je otevřený jen pro čtení – upravuje ho jiná karta.“), `notice.changeRejected` („Server změnu odmítl ({reason}).“), `notice.changeDropped` („Neuloženou změnu už nešlo použít na novější dokument; zahodila se.“). `sketch.notSolved` a `app.dismiss` existují.
- **Testy:** presenter (překlad s parametry, pořadí, tóny); SSR komponenty (role podle tónu, `aria-label` tlačítka, prázdný seznam nic nevykreslí); i18n povinné klíče a stejné klíče cs/en.
- **Hotovo když:** testy zelené, `App.vue` nemá vlastní markup toastu, `npm run check` zelený.

### 4. Úklid stavů bez zdroje (N144)

- **Soubory:** `src/app/app-session.ts`, `src/app/read-model-view.ts`, `src/app/connection-state.ts` (komentáře), `src/ui/title-bar-status.ts`, `src/ui/components/TitleBar.vue`, `src/interaction/file-actions.ts`, `src/interaction/testing.ts`, `src/app/remote-file-exporter.ts`, `src/ui/i18n/{cs,en}.ts`; testy `test/unit/ui/title-bar-status.test.ts`, `test/unit/interaction/file-actions.test.ts`, `test/unit/ui/i18n/i18n.test.ts`, `test/unit/app/*` podle potřeby.
- **Kontrakt:**
  - `RegenUiState` bez `failed` (pole, větev `titleBar.regen.failed`, klíč).
  - `KernelUiState = 'starting' | 'ready' | 'restarting' | 'unavailable'` (větev `'failed'` a klíč `titleBar.kernel.failed` pryč; tlačítko „zkusit znovu“ zůstává u `'unavailable'`).
  - Export bez historie: `FileWarning`, `EXPORTED_WITHOUT_HISTORY`, pole `withHistory` ve výsledku portu exportéru, `fileStatus.warning` v `TitleBar.vue` a klíč `file.exportedWithoutHistory` pryč. Když `withHistory` ještě něco jiného čte, implementátor to vrátí jako otázku.
  - **N146 zůstává:** `readOnly` je dál hodnota (ne Observable), `createEditLock` beze změny. Nové je jen hlášení `notice.readOnly` při odmítnutí (úkol 2).
- **Testy:** smazané větve se mažou s testy; `title-bar-status` pro zbylé stavy zelené.
- **Hotovo když:** `rg -n "regen.failed|kernel.failed|exportedWithoutHistory|withHistory|'failed'" src/app src/ui src/interaction` najde jen `PersistenceStatus 'failed'`; `npm run check` zelený.

### 5. E2E restartu jádra

- **Soubory:** nový `test/e2e/m48-lost-transaction.restart.spec.ts`; `test/e2e/core.ts` (`restartCore()`), `scripts/e2e-core.mjs` (příkaz `restart`), `playwright.config.ts` (projekt `restart`), `package.json` (`test:e2e`, `test:e2e:full`).
- **Kontrakt:**
  - `scripts/e2e-core.mjs restart` = `docker compose … restart core` (jméno služby jádra z `docker-compose.e2e.yml`); `restartCore()` ho spustí a počká, až `documentService().listDocuments({})` uspěje (nejvýš 60 s).
  - Projekt `restart`: `{ name: 'restart', use: { channel: 'chrome' }, testMatch: /\.restart\.spec\.ts$/, dependencies: ['chrome'] }`; projekty `chrome` a `webkit` mají `testIgnore: /\.restart\.spec\.ts$/`. Restart sdíleného jádra tak nikdy neběží souběžně s jinými testy. `test:e2e` = `playwright test --project=chrome --project=restart`; `test:e2e:full` beze změny (běží všechny projekty).
  - Scénář: nový dokument → kvádr → otevřít dialog úpravy kvádru → změnit šířku (transakce otevřená na serveru) → `restartCore()` → další změna v dialogu → toast s textem `notice.transactionLost` (cs) je vidět, dialog je zavřený, po chvíli `role=status` „Uloženo“; konzole bez chyb (fixture beze změny, žádné `allowedConsoleError`).
- **Proč ne e2e zamítnuté skici:** server vrací `SKETCH_NOT_SOLVED`, jen když jeho řešič nenajde řešení, které klient našel; v e2e to nejde vyvolat deterministicky. Pokrývá to unit test (b) úkolu 2 s falešným jádrem (N152 ⚠).
- **Testy:** `npm run test:e2e -- m48` a `npx playwright test --project=restart`; na konci `npm run test:e2e`.
- **Hotovo když:** oba běhy zelené dvakrát po sobě (restart nesmí být křehký).

### 6. Specifikace (hlavní sezení)

- [[11-ui]]: blok `AppSession` (`notices`, `dismissNotice`), modul `app/notices.ts` a `notice-sources.ts` v tabulce, pravidlo „Stav jádra a ukládání“ bez `failed` jádra, komponenta `ToastStack`, věta o N146.
- [[10-interakce]]: export bez varování „bez historie“.
- [[14-protokol]]: ztracená transakce se ukáže hlášením (odkaz na 11).

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_Návrh Clauda (stopa B)._

- Kanál `AppSession.notices` a `ToastStack`; hlášení ztráty transakce, zamítnuté změny (`noticeOfRefusal`), výpadku a obnovení spojení; nic z toho už nejde do `console.error`. Úklid stavů, které serverová cesta nenastaví (N144).
- E2E restartu jádra uprostřed dialogu v samostatném sériovém projektu `restart`; ukázalo se, že tmpfs nepřežije restart kontejneru – e2e data přešla do anonymního svazku (N158).
- `npm run check` zelený (5842 unit), `test:e2e` 104/104 dvakrát po sobě.
