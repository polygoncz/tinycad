---
type: spec
status: implemented
order: 2
aliases:
  - core – sdílené základy
  - Spec 02
modules:
  - core
milestones:
  - "[[M01-core]]"
  - "[[M12-skicar]]"
  - "[[M17-kamera-a-view-cube]]"
tags:
  - spec
created: 2026-10-12
updated: 2026-10-13
---
# 02 – `core`: sdílené základy

> **Pojmy:** [[Determinismus operací]], [[Port a adaptér]]  
> **Rozhodnutí:** [[0002-occt-wasm-ve-workeru]], [[0010-prezentacni-model]]  
> **Milník:** [[M01-core]]

Nejspodnější modul. **Nesmí importovat nic** – ani jiné moduly, ani knihovny, ani API platformy. Jedinou výjimkou je `gl-matrix` za fasádou v `src/core/math/` ([[0012-gl-matrix-za-fasadou|ADR 0012]]). Typuje se jen proti `ES2023`, bez DOM ([[0009-platformove-nezavisla-domena|ADR 0009]]), takže nemá ani `console`, `crypto` nebo `MessagePort`. Co z platformy potřebuje, dostane parametrem nebo přes vlastní strukturální typ ([[Q022 Platformové typy v core|Q022]]). Všechno ostatní na něm stojí, takže musí být malý, stabilní a dokonale otestovaný.

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
  next(): string;            // 10 znaků base62 (0-9A-Za-z), URL-safe
}
export type RandomSource = (bytes: Uint8Array<ArrayBuffer>) => void;  // naplní pole náhodnými bajty (typ jako crypto.getRandomValues)
export function createRandomIdGenerator(random: RandomSource): IdGenerator;
// app předá crypto.getRandomValues.bind(crypto); testy deterministický zdroj
export function createSequentialIdGenerator(prefix?: string): IdGenerator; // 'id1', 'id2', … pro testy
```

Formát rozhodnut v [[Q002 Formát ID|Q002]]. ID se generují **před** vytvořením operace, nikdy uvnitř `apply` (determinismus, viz [[04-operace-a-historie|04]]).

### Události

Typovaný emitter. Vrací funkci pro odhlášení, aby šel snadno použít s `DisposableStore`.

```ts
export type Unsubscribe = () => void;

// Samoreferenční omezení: projde interface i type. Record<string, unknown> by interface odmítl (nemá index signaturu).
export type EventMap<Events> = { [K in keyof Events]: unknown };

// Jen odběr – to, co vystavují veřejná rozhraní.
export interface Subscribable<Events extends EventMap<Events>> {
  on<K extends keyof Events>(type: K, fn: (e: Events[K]) => void): Unsubscribe;
  once<K extends keyof Events>(type: K, fn: (e: Events[K]) => void): Unsubscribe;
}

export class Emitter<Events extends EventMap<Events>> implements Subscribable<Events> {
  on<K extends keyof Events>(type: K, fn: (e: Events[K]) => void): Unsubscribe;
  once<K extends keyof Events>(type: K, fn: (e: Events[K]) => void): Unsubscribe;
  emit<K extends keyof Events>(type: K, e: Events[K]): void;
  /** Pohled jen s on/once, zmrazený, pokaždé tentýž objekt. */
  asSubscribable(): Subscribable<Events>;
}
```

Pravidla:

- Veřejná rozhraní jiných modulů vystavují jen odběr: `readonly events: Subscribable<…>`. `Emitter` si drží implementace soukromě a jen ony volají `emit` ([[Q023 Události jen pro odběr|Q023]]). Stejný vzor jako `Observable` vs. `ObservableValue`. Implementace vrací `emitter.asSubscribable()`: samostatný zmrazený objekt, takže ho spotřebitel nepřetypuje zpět na `Emitter`.
- Handlery se volají synchronně v pořadí registrace.
- Výjimka v jednom handleru neshodí ostatní. `emit` zavolá všechny handlery a teprve potom chybu vyhodí: jednu chybu tak, jak je, více chyb jako `AggregateError`. `core` nic neloguje (nemá `console`), logování je věc volajícího, který zná platformu ([[Q022 Platformové typy v core|Q022]]).
- Odhlášení během `emit` se projeví hned: odhlášený handler, který na řadu ještě nepřišel, se už nezavolá. Handler přihlášený během `emit` se zavolá až při dalším `emit`.

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
  asObservable(): Observable<T>;             // pohled jen s get/subscribe, vždy tentýž objekt
}
```

Snapshot musí být neměnný. Změna = nový objekt, takže odběratel pozná změnu porovnáním identity.

Veřejná rozhraní vystavují `value.asObservable()`, nikdy instanci `ObservableValue`: přetypování zpět by jinak dalo `set` (stejný vzor jako `Subscribable` vs. `Emitter`, revize M9).

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

/** Pohled jen pro čtení: dostávají ho spotřebitelé, kteří nic neregistrují (ADR 0011, revize M9). */
export type RegistryReader<T> = Pick<Registry<T>, 'get' | 'find' | 'has' | 'all'>;

export interface RegistryOptions<T> { readonly what: string; readonly keyOf: (item: T) => string }
export function createRegistry<T>(opts: RegistryOptions<T>): Registry<T>;
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

- `add` po `dispose` uvolní položku hned, jinak by tiše unikla.
- Výjimka v jedné položce nezastaví uvolnění ostatních. Chyby se vyhodí až na konci, stejně jako u `Emitter` (jedna chyba tak, jak je, více jako `AggregateError`).

Používají to hlavně `render` (Three.js geometrie a materiály) a `interaction` (posluchače událostí).

### Result

Pro očekávané chyby (validace, nevyřešená reference) místo výjimek. Výjimky jen pro chyby programátora.

```ts
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

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

Výpočty dělá knihovna **gl-matrix** schovaná za fasádou `vec3`/`mat4` ve složce `src/core/math/` ([[0012-gl-matrix-za-fasadou|ADR 0012]], porovnání knihoven v [[Q024 Knihovna pro vektorovou matematiku|Q024]]). Fasáda zapisuje výsledky vždy do nového obyčejného pole: výsledek je nový objekt a počítá se ve float64 (`create()` z gl-matrix by vrátil `Float32Array`). Typy gl-matrix se ven nedostanou, dependency-cruiser hlídá import jen z `src/core/math/`.

```ts
export type Vec3 = readonly [number, number, number];
export type Mat4 = readonly [number, /* … 16× */ number];  // n-tice 16 čísel, column-major (jako Three.js; OCCT gp_Trsf → převod)
export const EPSILON = 1e-9;                   // výchozí tolerance vec3.equals

export const vec3 = { add, sub, scale, dot, cross, length, normalize, equals };
export const mat4 = { identity, translation, rotationAxisAngle, multiply, transformPoint };

// M17 (kamera, ADR 0019): jednotkový quaternion [x, y, z, w]
export type Quat = readonly [number, number, number, number];
export const quat = {
  identity,                       // [0, 0, 0, 1]
  fromAxisAngle(axis: Vec3, angle: number): Quat,   // pravotočivě, osa se normalizuje (nulová = výjimka)
  fromBasis(right: Vec3, up: Vec3, direction: Vec3): Quat,  // rotace os x, y, z na zadanou ortonormální pravotočivou bázi
  multiply(a: Quat, b: Quat): Quat,                 // a·b, aplikuje nejdřív b (jako mat4)
  rotate(q: Quat, v: Vec3): Vec3,
  slerp(a: Quat, b: Quat, t: number): Quat,         // nejkratší cesta
  angle(a: Quat, b: Quat): number,                  // úhel rotace mezi a a b v radiánech, ⟨0, π⟩; 2·atan2(|v|, |w|) z conj(a)·b, ne getAngle z gl-matrix (acos ztrácí přesnost u malých úhlů)
  normalize(q: Quat): Quat,                         // nulový quaternion = výjimka (jako vec3.normalize)
};
```

- `Mat4` je n-tice, ne `number[]`: s `noUncheckedIndexedAccess` má pak každý index typ `number` a pole špatné délky neprojde.
- `normalize` nulového vektoru je chyba programátora (výjimka), ne tiché `NaN`.
- `equals(a, b, eps = EPSILON)` porovnává s tolerancí po složkách.
- `multiply(a, b)` = a·b, výsledek aplikuje nejdřív `b`. `transformPoint` dělí výslednou homogenní souřadnicí `w` (u afinních matic je `w = 1`).

**Rovina a 2D (M12, skicář):** `src/core/math/plane.ts`, bez gl-matrix (stačí fasáda `vec3`).

```ts
export type Vec2 = readonly [number, number];
/** Rámec roviny: počátek, jednotková osa x a jednotková normála, navzájem kolmé. Osa y = normal × xDir. */
export interface Plane { readonly origin: Vec3; readonly xDir: Vec3; readonly normal: Vec3 }
export const plane = {
  yDir(p: Plane): Vec3,                                        // normal × xDir
  toWorld(p: Plane, v: Vec2): Vec3,                            // origin + x·xDir + y·yDir
  toLocal(p: Plane, w: Vec3): Vec2,                            // kolmý průmět: [(w − origin)·xDir, (w − origin)·yDir]
  intersectRay(p: Plane, ray: { readonly origin: Vec3; readonly direction: Vec3 }): Vec3 | null,  // |direction·normal| < 1e-12 → null; průsečík i „za“ počátkem paprsku
  isOrthonormal(p: Plane, tolerance?: number): boolean,        // konečná čísla (i origin), |xDir| = |normal| = 1, xDir·normal = 0 (výchozí 1e-9)
};
```

**2D vektory (po sérii M30–M37):** `src/core/math/vec2.ts`, bez gl-matrix. Jediná implementace 2D vektorových pomůcek; dřív byla třikrát (`sketch/vec2.ts`, kopie v `kernel/vec2.ts`, protože `kernel` nesmí na `sketch`, a lokální funkce v `kernel-occt`, `sketcher`). Typ `Vec2` je tady, `plane` a `bspline` ho importují. Bez gl-matrix proto, že jde o pár řádků v horkých smyčkách oblastí a průsečíků a výsledky mají zůstat stejné jako u dřívějších kopií (`Math.hypot`). Dvě vědomé drobnosti při sjednocení: `normalize` nulového vektoru teď hází (dřív tiché `NaN`; volající mají úsečky už ověřené `parseSketchData`, takže nulu nedostanou) a `distanceToSegment` je vzorec z `bspline`, který nahradil skoro stejnou kopii v `sketch/curve-param.ts` (liší se nanejvýš v posledních bitech).

```ts
export type Vec2 = readonly [number, number];
export const TWO_PI = 2 * Math.PI;
export function mod2pi(angle: number): number;              // úhel do ⟨0, 2π), záporný se posune o 2π
export const vec2 = {
  add(a: Vec2, b: Vec2): Vec2,
  sub(a: Vec2, b: Vec2): Vec2,                              // a − b
  scale(v: Vec2, k: number): Vec2,
  addScaled(origin: Vec2, d: Vec2, t: number): Vec2,        // origin + t·d (bod na přímce, ne lerp mezi dvěma body)
  mid(a: Vec2, b: Vec2): Vec2,                              // (a + b) / 2
  dot(a: Vec2, b: Vec2): number,
  cross(a: Vec2, b: Vec2): number,                          // z-složka a × b: kladná, když b je proti směru hodinek od a
  length(v: Vec2): number,                                  // Math.hypot
  dist(a: Vec2, b: Vec2): number,                           // |a − b|
  normalize(v: Vec2): Vec2,                                 // nulový vektor = výjimka (jako vec3.normalize)
  angleOf(d: Vec2): number,                                 // atan2(y, x) v (−π, π⟩
  distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number,     // vzdálenost od úsečky ab (patka sevřená na úsečku); a = b → |p − a|
};
```

- Jmenný prostor jako `vec3`; volající si smí funkce rozbalit (`const { sub, dot } = vec2;`), aby hustý geometrický kód zůstal čitelný.
- `TWO_PI` a `mod2pi` patří k úhlům, ne k vektorům, proto jsou to samostatné exporty vedle `EPSILON`.

**B-spline (M29, spliny skici):** `src/core/math/bspline.ts`, bez gl-matrix. Polynomiální (bez vah) sevřený (clamped) B-spline ve 2D: vyhodnocení (de Boor), 1. a 2. derivace, adaptivní tessellace a globální interpolace bodů (Piegl–Tiller). Jmenný prostor `bspline` s typem `BSplineShape { degree; poles: Vec2[]; knots }`; kontrakt a chování v [[12-skicar#Spliny (M29)]]. V `core` je proto, že ji kromě `sketch` (oblasti, kresba, nástroje) potřebuje i `FakeKernel` a `kernel` smí jen na `core` ([[Q087 Spline v řešiči a v jádře – zjištění z implementace|Q087]]).

Rozsah roste podle potřeby, nic „do zásoby“.

### RPC pro workery

Malá typovaná vrstva nad `postMessage`, sdílená persistencí i jádrem. Vlastní implementace místo knihovny Comlink, protože jde o výukový projekt a je to cca 100 řádků ([[0002-occt-wasm-ve-workeru|ADR 0002]]).

```ts
// Protokol = mapa název metody → (argumenty, výsledek). Samoreferenční jako u Emitter, aby prošel i interface.
export type RpcProtocol<P> = { readonly [K in keyof P]: { readonly args: readonly unknown[]; readonly result: unknown } };

// Vlastní strukturální typ: MessagePort, Worker i DedicatedWorkerGlobalScope ho splní bez adaptéru.
export interface MessageEndpoint {
  postMessage(msg: unknown, transfer: ArrayBuffer[]): void;   // povinný: v DOM přetíženích je volitelná jen varianta s options
  addEventListener(type: 'message', fn: (e: { readonly data: unknown }) => void): void;
  start?(): void;                                              // MessagePort bez start() listenerům nic nedoručí
}

export interface RpcClient<P extends RpcProtocol<P>> extends Disposable {
  call<K extends keyof P & string>(method: K, ...args: P[K]['args']): Promise<P[K]['result']>;
  /** Spojení je mrtvé: čekající i všechna další volání odmítne RpcError('disconnected', message). */
  failAll(message: string): void;
  /** Jako failAll('RPC client disposed'), ale onDisconnected se neozve (vlastní ukončení není pád, M19.1). */
  dispose(): void;
  /** Spojení zemřelo (failAll): ozve se jednou, po odmítnutí čekajících volání; dispose se neozve. Pozdní přihlášení dostane událost hned (M19.1). */
  onDisconnected(listener: (error: RpcError) => void): Unsubscribe;
}
export type RpcImpl<P extends RpcProtocol<P>> = {
  readonly [K in keyof P]: (...args: P[K]['args']) => R | Transferred<R> | Promise<R | Transferred<R>>;  // R = P[K]['result']
};

export function createRpcClient<P extends RpcProtocol<P>>(ep: MessageEndpoint): RpcClient<P>;
export function serveRpc<P extends RpcProtocol<P>>(ep: MessageEndpoint, impl: RpcImpl<P>): void;
export function transfer<T>(value: T, buffers: readonly ArrayBuffer[]): Transferred<T>;
export class RpcError extends Error { readonly code: string }
```

- Implementace (`impl`) může být objektový literál i instance třídy. Metody se hledají i v prototypu (kromě `Object.prototype`) a volají se s `this = impl`.
- Klient volá explicitně `client.call('metoda', …)`, ne přes `Proxy` (`client.metoda(…)`). `Proxy` odpovídá na každou vlastnost včetně `then`, takže `await` na samotného klienta by uvízl.

- Každý požadavek má `id`, odpověď je `{ id, ok, value | error }`.
- Chyby se serializují jako `{ code, message }`, na straně klienta se z nich stane `RpcError`. Kód: řetězcové `code` vyhozené chyby, jinak `'internal'`; neznámá metoda má `'unknown-method'`; výsledek nebo argumenty, které nejde zkopírovat (`postMessage` vyhodí), mají `'unserializable'` a server ani klient tím nepřestanou fungovat.
- Přes hranici přežije jen `code` a `message`, ne třída chyby. Porty proto rozpoznávají chyby podle `code` (`storeErrorCode`, `kernelErrorCode`, [[Q039 Chyby jádra přes hranici workeru|Q039]]), ne podle třídy. Protokoly přenášejí data chyb, ne instance `Error`.
- Implementace může vrátit `transfer(value, [buffers])`, aby se velká pole nepřekopírovávala. Přenášejí se jen `ArrayBuffer` (sítě, buffery), jiné `Transferable` nepotřebujeme. Přenos funguje **jen pro výsledky**: velká data tečou z workeru ven (sítě z jádra). Přenos argumentů (např. snapshot do workeru persistence) se doplní, až ho bude potřeba ([[M04-persistence|M4]]).
- **Pád spojení** ([[Q037 Pád workeru a čekající RPC volání|Q037]], implementace v [[M07-kernel-occt|M7]]): `failAll(message)` přepne klienta natrvalo do stavu „odpojeno“. Všechna čekající volání se odmítnou `RpcError('disconnected', message)`, každé další `call` vrátí odmítnutý `Promise` se stejnou chybou a nic neposílá. Odpověď, která dorazí později, se ignoruje. `dispose()` se chová jako `failAll('RPC client disposed')`, jen neohlásí `onDisconnected` (od M19.1). Obojí je idempotentní: první volání vyhrává, další nic nezmění (zpráva chyby zůstane z prvního). Adaptéry napojí `worker.onerror`/`messageerror` na `failAll` (u `onerror` se zprávou z `ErrorEvent.message`, `messageerror` text nemá, takže pevná zpráva) a vlastní `dispose` na `rpc.dispose()` + `worker.terminate()`. Klienta RPC vytváří ten, kdo vlastní worker, aby mohl volat `failAll`; klientovi portu (`createDocumentStoreClient`, `createOcctKernelClient`) předá jen `Pick<RpcClient<P>, 'call'>` (úzké rozhraní, [[0011-programovani-proti-rozhranim|ADR 0011]]). Zrušení dlouhé operace řeší zvlášť [[Q010 Zrušení probíhající operace jádra|Q010]].
- **`onDisconnected`** ([[M19.1-opravy-z-revize|M19.1]]): o pádu workeru se vlastník dozví z klienta RPC, ne od toho, kdo se jako první zeptá. Událost vyšle `failAll` (pád workeru, trap, nečitelná zpráva) jednou, až po odmítnutí čekajících volání. `dispose` ji nevyšle, protože vlastní ukončení není pád. Kdo se přihlásí po pádu, dostane událost hned (synchronně). Výjimky posluchačů `failAll` vyhodí až po obsloužení všech, stejně jako `Emitter`.
- Pořadí: server zpracuje požadavky **sériově** v pořadí přijetí, další začne až po dokončení předchozího. Jednovláknovost workeru sama nestačí, dvě `async` metody (persistence nad IndexedDB) by se proplétaly.

## Testy

- `Emitter`: pořadí, odhlášení během emitu, výjimka v handleru.
- `ObservableValue`: oznámení jen při změně identity, odhlášení; `asObservable()` nemá `set` a je vždy tentýž objekt.
- `createRegistry`: duplicita a neznámý klíč (`get` vyhodí, `find` vrátí `undefined`), pořadí `all()`.
- `DisposableStore`: pořadí uvolnění, idempotence.
- `vec3`/`mat4`: základní identity.
- `plane` (M12): `toLocal(toWorld(v)) = v` pro tři počáteční roviny i obecnou ortonormální, `yDir` počátečních rovin, `intersectRay` (kolmý, šikmý, rovnoběžný → `null`), `isOrthonormal` (nejednotková, nekolmá, `NaN` → `false`).
- RPC: klient + server propojené přes `MessageChannel` v Node (Vitest), chyby, transfer.
- RPC odpojení: `failAll` odmítne čekající volání (`'disconnected'`, zpráva z `failAll`), další `call` odmítne bez odeslání, pozdní odpověď serveru se ignoruje, druhé `failAll` zprávu nezmění, `dispose` se chová jako `failAll`. `onDisconnected`: jednou po `failAll`, po odmítnutí volání, ne po `dispose`, pozdní přihlášení, odhlášení, vyhazující posluchač (M19.1).

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
