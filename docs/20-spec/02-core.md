---
type: spec
status: draft
order: 2
aliases:
  - core – sdílené základy
  - Spec 02
modules:
  - core
milestones:
  - "[[M01-core]]"
tags:
  - spec
created: 2026-10-12
updated: 2026-10-13
---
# 02 – `core`: sdílené základy

> **Pojmy:** [[Determinismus operací]], [[Port a adaptér]]  
> **Rozhodnutí:** [[0002-occt-wasm-ve-workeru]], [[0010-prezentacni-model]]  
> **Milník:** [[M01-core]]

Nejspodnější modul. **Nesmí importovat nic** – ani jiné moduly, ani knihovny, ani DOM API (kromě typů jako `MessagePort` v `rpc`). Všechno ostatní na něm stojí, takže musí být malý, stabilní a dokonale otestovaný.

## Obsah

### Značkované typy (branded types)

Zabrání záměně různých ID, i když jsou všechna `string`.

```ts
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

// použití v jiných modulech:
export type FeatureId = Brand<string, 'FeatureId'>;
```

### Generátor ID

```ts
export interface IdGenerator {
  next(): string;            // krátké, URL-safe, náhodné (např. 10 znaků base62)
}
export function createRandomIdGenerator(): IdGenerator;                // crypto.getRandomValues
export function createSequentialIdGenerator(prefix?: string): IdGenerator; // 'id1', 'id2', … pro testy
```

ID se generují **před** vytvořením operace, nikdy uvnitř `apply` (determinismus, viz [[04-operace-a-historie|04]]).

### Události

Typovaný emitter. Vrací funkci pro odhlášení, aby šel snadno použít s `DisposableStore`.

```ts
export type Unsubscribe = () => void;

export class Emitter<Events extends Record<string, unknown>> {
  on<K extends keyof Events>(type: K, fn: (e: Events[K]) => void): Unsubscribe;
  once<K extends keyof Events>(type: K, fn: (e: Events[K]) => void): Unsubscribe;
  emit<K extends keyof Events>(type: K, e: Events[K]): void;
}
```

Pravidla: handlery se volají synchronně v pořadí registrace; výjimka v jednom handleru se zaloguje a neshodí ostatní.

### Observable

Kontrakt, přes který [[Prezentační model|prezentační modely]] vystavují stav pro UI ([[0010-prezentacni-model|ADR 0010]]). Je záměrně nezávislý na frameworku: tvar `get` + `subscribe` se mapuje na Vue `shallowRef`, React `useSyncExternalStore` i Svelte stores.

```ts
export interface Observable<T> {
  get(): T;                                  // immutable snapshot
  subscribe(fn: () => void): Unsubscribe;
}

export class ObservableValue<T> implements Observable<T> {
  constructor(initial: T);
  get(): T;
  set(value: T): void;                       // notifies only if !Object.is(old, value)
  subscribe(fn: () => void): Unsubscribe;
}
```

Snapshot musí být neměnný. Změna = nový objekt, takže odběratel pozná změnu porovnáním identity.

### Registry

Společný tvar pro všechny registry podle typu (schémata featur, handlery operací, buildery, nástroje). Díky tomu se registry chovají všude stejně ([[0011-programovani-proti-rozhranim|ADR 0011]]).

```ts
export interface Registry<T> {
  register(item: T): void;              // duplicitní klíč = chyba programátora (výjimka)
  get(key: string): T;                  // neznámý klíč = výjimka
  find(key: string): T | undefined;     // neznámý klíč = undefined
  has(key: string): boolean;
  all(): readonly T[];                  // v pořadí registrace
}

export function createRegistry<T>(opts: { what: string; keyOf: (item: T) => string }): Registry<T>;
// what = název pro chybové hlášky ('feature schema', 'op handler'…)
```

### Výjimky z programování proti rozhraním

`core` vystavuje tři malé třídy přímo: `Emitter`, `ObservableValue`, `DisposableStore`. Jsou to stavební kameny bez variability, výjimka podle [[0011-programovani-proti-rozhranim|ADR 0011]]. Vše ostatní (generátory ID, registry) je rozhraní + tovární funkce.

### Správa životnosti

```ts
export interface Disposable { dispose(): void }

export class DisposableStore implements Disposable {
  add<T extends Disposable | Unsubscribe>(d: T): T;
  dispose(): void;           // uvolní vše v opačném pořadí, idempotentní
}
```

Používají to hlavně `render` (Three.js geometrie a materiály) a `interaction` (posluchače událostí).

### Result

Pro očekávané chyby (validace, nevyřešená reference) místo výjimek. Výjimky jen pro chyby programátora.

```ts
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
```

### Asserty

```ts
export function assert(cond: unknown, msg?: string): asserts cond;
export function assertNever(x: never): never;   // pro vyčerpávající switch
```

### Matematika (hodnotové typy)

Jen neměnné hodnotové typy a čisté funkce. Žádná závislost na Three.js – převod na `THREE.Vector3` dělá `render`.

```ts
export type Vec3 = readonly [number, number, number];
export type Mat4 = readonly number[];          // 16 čísel, column-major (jako Three.js i OCCT gp_Trsf → převod)

export const vec3 = { add, sub, scale, dot, cross, length, normalize, equals };
export const mat4 = { identity, translation, rotationAxisAngle, multiply, transformPoint };
```

Rozsah roste podle potřeby, nic „do zásoby“.

### RPC pro workery

Malá typovaná vrstva nad `postMessage`, sdílená persistencí i jádrem. Vlastní implementace místo knihovny Comlink, protože jde o výukový projekt a je to cca 100 řádků ([[0002-occt-wasm-ve-workeru|ADR 0002]]).

```ts
// Protokol = mapa název metody → (argumenty, výsledek)
export type RpcProtocol = Record<string, { args: unknown[]; result: unknown }>;

export interface MessageEndpoint {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
}

export function createRpcClient<P extends RpcProtocol>(ep: MessageEndpoint): RpcClient<P>;
export function serveRpc<P extends RpcProtocol>(ep: MessageEndpoint, impl: RpcImpl<P>): void;
```

- Každý požadavek má `id`, odpověď je `{ id, ok, value | error }`.
- Chyby se serializují jako `{ code, message }`, na straně klienta se z nich stane `RpcError`.
- Implementace může vrátit `transfer(value, [buffers])`, aby se velká pole nepřekopírovávala.
- Pořadí: požadavky se ve workeru zpracují v pořadí přijetí (worker je jednovláknový).

## Testy

- `Emitter`: pořadí, odhlášení během emitu, výjimka v handleru.
- `ObservableValue`: oznámení jen při změně identity, odhlášení.
- `createRegistry`: duplicita a neznámý klíč (`get` vyhodí, `find` vrátí `undefined`), pořadí `all()`.
- `DisposableStore`: pořadí uvolnění, idempotence.
- `vec3`/`mat4`: základní identity.
- RPC: klient + server propojené přes `MessageChannel` v Node (Vitest), chyby, transfer.

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
