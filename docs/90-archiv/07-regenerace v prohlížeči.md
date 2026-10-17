---
type: spec
status: implemented
order: 7
aliases:
  - "07-regenerace v prohlížeči"
  - Regenerace v prohlížeči
modules:
  - regen
milestones:
  - "[[M06-regenerace]]"
  - "[[M11-dalsi-entity]]"
  - "[[M12-skicar]]"
  - "[[M13-extrude-revolve]]"
  - "[[M14-topologicke-pojmenovani]]"
tags:
  - spec
  - archiv
created: 2026-10-17
updated: 2026-10-17
---
# 07 – Regenerace v prohlížeči (archiv)

Archivováno v [[M47-uklid-a-dokonceni|M47]] ([[Rozhodnutí nativního jádra|N128]]). Platná specifikace je [[07-regenerace]]. Text níže popisuje TS regeneraci v prohlížeči do [[M46-klient-nad-read-modelem|M46]] (modul `regen` nad jádrem ve workeru, [[06-geometricke-jadro v prohlížeči]]): asynchronní `run` s generacemi a `'superseded'`, události, ztrátu jádra po pádu workeru a testy s `FakeKernel`. Serverová regenerace v C++ to nemá ([[Rozhodnutí nativního jádra|N40]]). Kód smazal úkol 3 M47, je v historii gitu před M47. Text je přesunutý beze změny; odkazy na nadpisy, které zůstaly ve specifikaci, vedou do [[07-regenerace]].

## Pád jádra během regenerace (z oddílu *Stav featury*)

Když builder (nebo jiné volání jádra) odmítne s `RpcError` `'disconnected'`, jádro zaniklo i se všemi handle ([[Q049 Pád jádra během regenerace|Q049]]): featura nedostane status, `run` odmítne s touto chybou a regen hned – bez volání `release` – vyprázdní cache i vlastněnou množinu a přejde do stavu **mrtvý**: běžící i každý další `run` odmítne původní chybou `'disconnected'` (i běh, který jádro vůbec nevolá a vše bere z cache). Ochranou je tento příznak, ne pořadí zápisů: mrtvý Regenerator cache už nikdy nečte. Mrtvý `run` odmítne hned, bez zvýšení generace a bez `started`. Zotavení řeší `app`: nové jádro a nový Regenerator.

## Rozhraní `Regenerator` v TS (z oddílu *Regenerator*)

```ts
export interface Regenerator {

  /** Přepočítá studio. Volání během běžící regenerace ji nahradí (starý výsledek se zahodí). */
  run(studio: PartStudioData, opts?: { readonly inputOf?: FeatureId }): Promise<RegenResult | 'superseded'>;

  readonly events: Subscribable<RegenEvents>;
}

export interface RegenEvents {      // exportovaný typ, app ho pojmenuje
  readonly started: { readonly generation: number };
  readonly featureDone: { readonly generation: number; readonly featureId: FeatureId; readonly status: FeatureStatus };
  readonly finished: { readonly generation: number; readonly result: RegenResult };
}

export function createRegenerator(deps: {
  kernel: ModelingKernel & Pick<GeometryKernel, 'release'>; builders: RegistryReader<FeatureBuilder>; schemas: RegistryReader<FeatureSchema>;   // jen čtení (ADR 0011)
  now: () => number;                // hodiny pro durationMs, dodá app (Q046)
}): Regenerator;

export interface RegenResult {
  readonly generation: number;
  readonly finalState: RegenState;                 // stav na rollback baru
  readonly statuses: ReadonlyMap<FeatureId, FeatureStatus>;
  readonly anchors: ReadonlyMap<FeatureId, FeatureAnchors>;   // viz Kotvy manipulátorů
  /** Vstup featury opts.inputOf (stav před ní), null bez inputOf nebo když featura před lištou není (ADR 0025). */
  readonly input: { readonly feature: FeatureId; readonly state: RegenState } | null;
  readonly durationMs: number;
}
```

### Souběh (generace)

- Každé `run` zvýší `generation`. Po každém `await` builder smyčka ověří, že je stále aktuální generací; pokud ne, skončí a vrátí `'superseded'`.
- Cache zapisuje jen aktuální generace.
- `started` a `featureDone` se vysílají i pro generaci, která pak skončí jako `'superseded'` (posluchač filtruje podle `generation`). `finished` jen pro dokončenou generaci, jako poslední událost před vyřešením promise.
- `featureDone` dostane každá featura studia právě jednou, v pořadí featur: featury z cache hned po `started`, přepočítaná featura hned po svém buildu, `rolledBack` featury při sestavení výsledku. Featura, jejíž build doběhl až po nahrazení generace, událost nedostane.
- Výjimka mimo jádro (Q043) odmítne `run` i v generaci, která už je nahrazená – chyba programu se neschová do `'superseded'`. Sweep po ní ale udělá jen aktuální generace.
- Výjimka posluchače události je také chyba programu: `Emitter` ji pošle dál a `run` odmítne. U `started`/`featureDone` se cache nezapíše (jako u Q043); u `finished` už je cache zapsaná a uklizená a zůstává, výsledek je platný.
- Plánování (debounce, „spusť znovu po doběhnutí“) dělá `RegenScheduler` v `app`, ne `Regenerator`.

## Úklid handle při souběhu a pádu jádra (z oddílu *Životnost handle: mark & sweep*)

3. Handle vytvořené v rámci zahozené (superseded) generace se uvolní nejpozději při sweepu prvního dokončeného běhu, který začne po jejich vytvoření (build nahrazeného běhu může doběhnout až po sweepu generace, která ho nahradila).

Sweep běží na konci každého `run`, který skončí jako aktuální generace – výsledkem i výjimkou (Q043, chyba posluchače). Běh, který skončí jako nahrazený, neuklízí. Superseded běh sám neuklízí – jeho handle uklidí sweep generace, která ho nahradila. Všechny nepotřebné handle se uvolní **jedním** voláním `kernel.release`. Když `release` odmítne ([[Q040 Selhání release při úklidu handle|Q040]]):

- `'unknown-handle'` – chyba programu (regen vlastnil handle, který jádro nezná): `run` odmítne s touto chybou. `release` je atomický, handle proto zůstanou ve vlastněné množině a každý další sweep selže znovu – chyba programu má být hlasitá, ne tichý únik,
- jiný kód jádra (`'internal'`) – handle zůstanou ve vlastněné množině a zkusí se při příštím sweepu, `run` se vyřeší normálně,
- `RpcError` `'disconnected'` ([[Q037 Pád workeru a čekající RPC volání|Q037]]) – jádro je pryč, vlastněná množina i cache se vyprázdní, `run` odmítne s touto chybou,
- jiná chyba bez kódu jádra – chyba programu jako u Q043: handle zůstanou ve vlastněné množině, `run` odmítne.

Handle se z vlastněné množiny odeberou ještě před čekáním na `release` (souběžný sweep novějšího běhu je tak neuvolní podruhé) a při selhání s kódem jádra se vrátí. Sweep proběhne před `finished`, `durationMs` ho zahrnuje. Když během čekání na `release` začne novější běh, vrátí `run` `'superseded'`. Když `run` odmítne kvůli `release`, `finished` se nevyšle. Po výjimce builderu nebo posluchače má původní výjimka přednost před chybou sweepu.

`render` drží handle jen pro dobu tessellace a nikdy ho neuvolňuje. Uvolnění tessellaci předběhnout nemůže: `app` zveřejní a uvolní až po `await viewport.bodies.sync` a worker zprávy zpracuje v pořadí. Kdyby se to přesto stalo, jádro odmítne s kódem `'unknown-handle'` a `SceneSync` chybu tělesa předá `reportError` (výchozí `console.error`), jako každou jinou chybu tessellace; zvláštní zacházení s `unknown-handle` v `render` není.

## Testy (s `FakeKernel`)

- Změna parametru featury 3 z 5 přepočítá jen 3–5 (počítadlo volání builderu).
- Posun rollback baru dozadu nevolá jádro, posun zpět dopředu také ne.
- Chybná featura: status `error`, následující featury `ok`, stav propuštěn.
- Neplatné parametry → `INVALID_PARAMS`, builder se nezavolá.
- `unresolvedReference` dá kód, zprávu z `RefError` a `issues` s parametrem, zmrazené do hloubky; sledované jádro zapíše handle z `makeCylinder`, `transform` a `boolean` (M11).
- Neznámý typ featury (chybí schéma nebo builder) → `UNKNOWN_TYPE`, regenerace pokračuje.
- Kotvy (M18): builder s kotvami → `RegenResult.anchors` je má pod id featury, hluboce zmrazené; featura z cache (builder se nevolá) je má také; chybná, potlačená a `rolledBack` featura v mapě nejsou, featura bez manipulátoru má `{}`; po opravě chybné featury se kotvy vrátí.
- M12: `EMPTY_STATE` má tři roviny; `resolvePlanes` (existující rovina, chybějící id, id tělesa → err); sledované jádro zapíše handle z `makeFace`; sweep: plochy oblastí skici jsou živé, po smazání skici se uvolní (`liveHandleCount`).
- M13: `EMPTY_STATE` má za rovinami tři osy; `axesOf`; `resolveRegions` (oblast, chybějící skica, chybějící jméno, id tělesa); `resolveAxis` (osa počátku, úsečka skici na XZ ve světových souřadnicích, konstrukční úsečka, kružnice → err, nulová délka); `applyBodyOperation` pro všechny čtyři operace (identita, pořadí mapy, jedno `union` u více tvarů, cíle zvlášť u `remove`/`intersect`); sledované jádro zapíše handle z `extrude` a `revolve`.
- M14: `propagateNames` na ručně sestavených historiích ([[08-topologicke-pojmenovani]] – role, identita, rozdělení, sloučení, generated z hrany a vrcholu, zánik, hrany včetně kontextu a `#k`, šev, plocha bez jména, determinismus vůči pořadí, výjimka u indexu mimo rozsah); `nameShape` s `FakeKernel`; `resolveTopo` (plocha, hrana, víc ploch → varování, víc hran bez varování, chybějící jméno, chybějící těleso, artefakt jiného druhu); `resolvePlanes` s `TopoRef` (horní plocha kvádru → rovina `z = h` s rámcem X/Y, nerovinná plocha → err, víc ploch → varování); `sketchPlaneOfFace` pro normály ±X, ±Y, ±Z a šikmou; `planeOfRef`; `applyBodyOperation` s jmény (role hranolu, přenos přes boolean); sledované jádro zapíše handle z `fillet` a `chamfer`.
- Featura s `typeVersion` jiným, než má schéma → `STALE_VERSION`, builder se nezavolá, stav propuštěn.
- Suppressed featura propustí stav, builder se nezavolá.
- Status z cache se zachová (`warning` i `error` featury před změnou).
- `warn` dvakrát → jeden `warning` se zprávami spojenými `'\n'`.
- Výjimka jádra (`failNext('makeBox', …)`) → `KERNEL` (od M19.2 s issue `kernel.operationFailed` a `param: ''`); jiná výjimka → `run` odmítne a handle se přesto uklidí.
- Builder vytvoří mezivýsledek a vrátí chybu → handle se uvolní.
- Souběh: dvě rychlé `run`, první vrátí `'superseded'`, cache odpovídá druhé, žádné úniky.
- Události: pořadí `started`, `featureDone`…, `finished`; `finished` jen pro dokončenou generaci.
- `release` selže: `unknown-handle` → odmítnutí; `internal` → úklid při dalším běhu; `disconnected` → cache prázdná.
- `durationMs` z falešných hodin.
- Property-based (fast-check): regenerace s cache = regenerace od nuly (stejná tělesa a statusy); po náhodné sekvenci změn žádné úniky handle.
