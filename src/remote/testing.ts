// Test-only entry point of remote: a fake core over the router transport of connect (SessionService
// and DocumentService in memory, scripted by the test) and builders of the protocol messages it
// answers with. dependency-cruiser allows importing it only from tests.

import { create, fromJson } from '@bufbuild/protobuf';
import type { DescMessage, JsonValue, MessageInitShape, MessageShape } from '@bufbuild/protobuf';
import { ListValueSchema } from '@bufbuild/protobuf/wkt';
import { ConnectError, createRouterTransport } from '@connectrpc/connect';
import type { Code, HandlerContext, Transport } from '@connectrpc/connect';
import type { Disposable } from '@/core';
import type { MeshData } from '@/kernel';
import {
  BodyViewSchema,
  DocumentService,
  DocumentViewSchema,
  ErrorDetailSchema,
  FeatureTypeDescriptorSchema,
  MeshSchema,
  ReadModelSchema,
  RegenViewSchema,
  SessionService,
  SessionViewSchema,
  SketchViewSchema,
} from '@/protocol';
import type {
  BodyView,
  ErrorReason,
  FeatureTypeDescriptor,
  Mesh,
  ReadModel,
  SketchView,
} from '@/protocol';
import type { Timers } from './session-contract';

// ---- builders ----------------------------------------------------------------------------------

/** The plain init object of a message (not a message itself), so overrides spread over defaults. */
export type PlainInit<Desc extends DescMessage> = Exclude<
  MessageInitShape<Desc>,
  { readonly $typeName: string }
>;

/** The parts of a read model a test overrides: each merges field by field over the default. */
export interface ReadModelOverrides {
  readonly document?: PlainInit<typeof DocumentViewSchema>;
  readonly regen?: PlainInit<typeof RegenViewSchema>;
  readonly session?: PlainInit<typeof SessionViewSchema>;
}

/**
 * A read model of an empty document 'doc-1' named 'Document', generation 1, without bodies, in a
 * writable session; `overrides` replace fields of the document, regen and session.
 */
export function aReadModel(overrides: ReadModelOverrides = {}): ReadModel {
  return create(ReadModelSchema, {
    document: {
      documentId: 'doc-1',
      name: 'Document',
      lastSeq: 0n,
      features: [],
      rollbackIndex: 0,
      ...overrides.document,
    },
    regen: { generation: 1n, final: {}, ...overrides.regen },
    session: { writable: true, ...overrides.session },
  });
}

/**
 * A body 'f1/body' of the feature 'f1' with content version 'v1', two named faces, one planar
 * (index 0 at z = 1) and its mesh (one triangle, aMeshData); `overrides` replace fields.
 */
export function aBodyView(overrides: PlainInit<typeof BodyViewSchema> = {}): BodyView {
  return create(BodyViewSchema, {
    bodyId: 'f1/body',
    origin: 'f1',
    lastModifiedBy: 'f1',
    contentVersion: 'v1',
    faceNames: ['face:top', ''],
    edgeNames: ['edge:a'],
    facePlanes: {
      0: {
        origin: { x: 0, y: 0, z: 1 },
        normal: { x: 0, y: 0, z: 1 },
        xDir: { x: 1, y: 0, z: 0 },
      },
    },
    mesh: meshToProto(aMeshData()),
    ...overrides,
  });
}

/**
 * A sketch 'f2/sketch' of the feature 'f2' on the plane XY with one line entity and one square
 * region; `overrides` replace fields.
 */
export function aSketchView(overrides: PlainInit<typeof SketchViewSchema> = {}): SketchView {
  const line = (id: string, from: [number, number], to: [number, number]) => ({
    id,
    kind: {
      case: 'line' as const,
      value: { from: { x: from[0], y: from[1] }, to: { x: to[0], y: to[1] } },
    },
  });
  return create(SketchViewSchema, {
    sketchId: 'f2/sketch',
    featureId: 'f2',
    plane: {
      origin: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 0, z: 1 },
      xDir: { x: 1, y: 0, z: 0 },
    },
    entities: listValue([{ kind: 'line', id: 'a', from: [0, 0], to: [1, 0] }]),
    regions: [
      {
        name: 'a,b,c,d',
        outer: [
          line('a', [0, 0], [1, 0]),
          line('b', [1, 0], [1, 1]),
          line('c', [1, 1], [0, 1]),
          line('d', [0, 1], [0, 0]),
        ],
        holes: [],
        area: 1,
      },
    ],
    ...overrides,
  });
}

/**
 * A feature type 'thing' version 1 with one length 'size' (default 10, > 0) and defaults
 * { size: 10 }; `overrides` replace fields.
 */
export function aFeatureTypeDescriptor(
  overrides: PlainInit<typeof FeatureTypeDescriptorSchema> = {},
): FeatureTypeDescriptor {
  return create(FeatureTypeDescriptorSchema, {
    type: 'thing',
    version: 1,
    label: 'thing.label',
    icon: 'box',
    params: [
      {
        key: 'size',
        label: 'thing.size',
        spec: { case: 'length', value: { defaultValue: 10, min: 0, exclusiveMin: true } },
      },
    ],
    defaults: { size: 10 },
    ...overrides,
  });
}

/** One triangle in the plane z = 0 with one face and one edge: a valid MeshData. */
export function aMeshData(): MeshData {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    faceRanges: new Uint32Array([0, 0, 1]),
    edgePositions: new Float32Array([0, 0, 0, 1, 0, 0]),
    edgeRanges: new Uint32Array([0, 0, 2]),
  };
}

/** MeshData → the message Mesh, as the core encodes it (little-endian words). */
export function meshToProto(mesh: MeshData): Mesh {
  const bytes = (a: Float32Array | Uint32Array): Uint8Array =>
    new Uint8Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength));
  return create(MeshSchema, {
    positions: bytes(mesh.positions),
    normals: bytes(mesh.normals),
    indices: bytes(mesh.indices),
    faceRanges: bytes(mesh.faceRanges),
    edgePositions: bytes(mesh.edgePositions),
    edgeRanges: bytes(mesh.edgeRanges),
  });
}

/** A JSON array as the message ListValue (entities of a sketch, tests of VisibleWhen). */
export function listValue(items: readonly JsonValue[]): MessageShape<typeof ListValueSchema> {
  return fromJson(ListValueSchema, [...items]);
}

/** A failed RPC as the core sends it: a status with one ErrorDetail (spec 14 "Chyby"). */
export function aCoreError(
  code: Code,
  reason: ErrorReason,
  detail: Omit<MessageInitShape<typeof ErrorDetailSchema>, 'reason'> = {},
): ConnectError {
  return new ConnectError(`fake core: ${String(reason)}`, code, undefined, [
    { desc: ErrorDetailSchema, value: { reason, ...detail } },
  ]);
}

// ---- fake core ---------------------------------------------------------------------------------

type Methods = (typeof SessionService)['method'] & (typeof DocumentService)['method'];

/** Every method of SessionService and DocumentService by its local name ('openSession'). */
export type FakeMethod = keyof Methods;
/** The unary methods: all but WatchSession. */
export type FakeUnaryMethod = Exclude<FakeMethod, 'watchSession'>;
export type FakeRequest<M extends FakeMethod> = MessageShape<Methods[M]['input']>;
export type FakeResponse<M extends FakeUnaryMethod> = MessageInitShape<Methods[M]['output']>;

/**
 * The answer of one call: a response, an error (thrown to the client, e.g. aCoreError) or a
 * function of the request that returns either (it may return a promise the test resolves later,
 * to hold the call in flight, or throw).
 */
export type FakeAnswer<M extends FakeUnaryMethod> =
  | FakeResponse<M>
  | Error
  | ((request: FakeRequest<M>) => FakeResponse<M> | Promise<FakeResponse<M>>);

/** An event of WatchSession as the test writes it. */
export type FakeEvent = MessageInitShape<
  (typeof SessionService)['method']['watchSession']['output']
>;

export interface FakeCore {
  /** The transport of a client of the fake core. */
  readonly transport: Transport;
  /** Queues answers of the next calls of `method`, in order. */
  respond<M extends FakeUnaryMethod>(method: M, ...answers: readonly FakeAnswer<M>[]): void;
  /**
   * The answer of `method` when its queue is empty (default: a response with aReadModel() where
   * the response has a read model, session 'session-1' for OpenSession, an empty response
   * otherwise).
   */
  fallback<M extends FakeUnaryMethod>(method: M, answer: FakeAnswer<M>): void;
  /** The requests of `method` received so far, in order. */
  requests<M extends FakeMethod>(method: M): readonly FakeRequest<M>[];
  /** The methods of all calls received so far, in order. */
  readonly calls: readonly FakeMethod[];
  /** Sends an event to every open WatchSession stream. */
  emit(event: FakeEvent): void;
  /** Ends every open WatchSession stream: with OK, or with the error. */
  endStreams(error?: Error): void;
  /** The number of open WatchSession streams. */
  readonly openStreams: number;
}

/**
 * A fake SessionService and DocumentService over createRouterTransport: every call is recorded
 * and answered from the queue of its method (respond), or by its fallback. WatchSession streams
 * stay open until endStreams or until the client cancels them; emit sends to all of them.
 */
export function createFakeCore(): FakeCore {
  return new FakeCoreImpl();
}

class FakeCoreImpl implements FakeCore {
  readonly transport: Transport;
  private readonly queues = new Map<FakeMethod, unknown[]>();
  private readonly fallbacks = new Map<FakeMethod, unknown>();
  private readonly received = new Map<FakeMethod, unknown[]>();
  private readonly order: FakeMethod[] = [];
  private readonly streams = new Set<FakeStream>();

  constructor() {
    const unary =
      <M extends FakeUnaryMethod>(method: M) =>
      (request: FakeRequest<M>): Promise<FakeResponse<M>> =>
        this.answer(method, request);
    this.transport = createRouterTransport(({ service }) => {
      service(SessionService, {
        openSession: unary('openSession'),
        closeSession: unary('closeSession'),
        getReadModel: unary('getReadModel'),
        dispatch: unary('dispatch'),
        beginTransaction: unary('beginTransaction'),
        apply: unary('apply'),
        applyTransient: unary('applyTransient'),
        commit: unary('commit'),
        abort: unary('abort'),
        undo: unary('undo'),
        redo: unary('redo'),
        getHistory: unary('getHistory'),
        exportStep: unary('exportStep'),
        watchSession: (request, context) => this.watch(request, context),
      });
      service(DocumentService, {
        listDocuments: unary('listDocuments'),
        createDocument: unary('createDocument'),
        renameDocument: unary('renameDocument'),
        deleteDocument: unary('deleteDocument'),
        importDocument: unary('importDocument'),
        exportDocument: unary('exportDocument'),
      });
    });
  }

  get calls(): readonly FakeMethod[] {
    return [...this.order];
  }

  get openStreams(): number {
    return this.streams.size;
  }

  respond<M extends FakeUnaryMethod>(method: M, ...answers: readonly FakeAnswer<M>[]): void {
    this.listOf(this.queues, method).push(...answers);
  }

  fallback<M extends FakeUnaryMethod>(method: M, answer: FakeAnswer<M>): void {
    this.fallbacks.set(method, answer);
  }

  requests<M extends FakeMethod>(method: M): readonly FakeRequest<M>[] {
    // record() keeps only requests of `method` under its key
    return [...this.listOf(this.received, method)] as FakeRequest<M>[];
  }

  emit(event: FakeEvent): void {
    for (const stream of this.streams) stream.push(event);
  }

  endStreams(error?: Error): void {
    for (const stream of [...this.streams]) stream.end(error);
  }

  private async answer<M extends FakeUnaryMethod>(
    method: M,
    request: FakeRequest<M>,
  ): Promise<FakeResponse<M>> {
    this.record(method, request);
    const queued = this.listOf(this.queues, method).shift();
    // respond() and fallback() store only answers of `method` under its key
    const answer = (queued ?? this.fallbacks.get(method) ?? defaultAnswer(method)) as FakeAnswer<M>;
    if (answer instanceof Error) throw answer;
    if (typeof answer === 'function') return answer(request);
    return answer;
  }

  private async *watch(
    request: FakeRequest<'watchSession'>,
    context: HandlerContext,
  ): AsyncIterable<FakeEvent> {
    this.record('watchSession', request);
    const stream = new FakeStream(context.signal);
    this.streams.add(stream);
    try {
      for (;;) {
        const next = await stream.next();
        if (next === null) return;
        yield { event: next };
      }
    } finally {
      this.streams.delete(stream);
    }
  }

  private record(method: FakeMethod, request: unknown): void {
    this.order.push(method);
    this.listOf(this.received, method).push(request);
  }

  private listOf(map: Map<FakeMethod, unknown[]>, method: FakeMethod): unknown[] {
    let list = map.get(method);
    if (list === undefined) {
      list = [];
      map.set(method, list);
    }
    return list;
  }
}

/** The events of one open WatchSession stream, waiting for the test. */
class FakeStream {
  private readonly events: NonNullable<FakeEvent['event']>[] = [];
  private wake: (() => void) | null = null;
  private ended = false;
  private error: Error | undefined;

  constructor(signal: AbortSignal) {
    signal.addEventListener('abort', () => {
      this.end();
    });
  }

  push(event: FakeEvent): void {
    if (event.event !== undefined) this.events.push(event.event);
    this.notify();
  }

  end(error?: Error): void {
    this.ended = true;
    this.error = error;
    this.notify();
  }

  /** The next event, or null when the stream ended with OK; throws the error it ended with. */
  async next(): Promise<NonNullable<FakeEvent['event']> | null> {
    for (;;) {
      const event = this.events.shift();
      if (event !== undefined) return event;
      if (this.ended) {
        if (this.error !== undefined) throw this.error;
        return null;
      }
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }
}

/** The fallback answer of a method without one set. */
function defaultAnswer(method: FakeUnaryMethod): FakeAnswer<FakeUnaryMethod> {
  switch (method) {
    case 'openSession':
      return { sessionId: 'session-1', readModel: aReadModel(), eventSeq: 0n };
    case 'getReadModel':
      return { readModel: aReadModel() };
    case 'dispatch':
    case 'beginTransaction':
    case 'apply':
    case 'applyTransient':
    case 'commit':
    case 'abort':
    case 'undo':
    case 'redo':
      return { result: { readModel: aReadModel() } };
    case 'closeSession':
    case 'getHistory':
    case 'exportStep':
    case 'listDocuments':
    case 'createDocument':
    case 'renameDocument':
    case 'deleteDocument':
    case 'importDocument':
    case 'exportDocument':
      return {};
  }
}

// ---- timers --------------------------------------------------------------------------------------

/** Timers of a session the test drives: nothing runs until advance (tests never sleep). */
export interface ManualTimers extends Timers {
  /** Moves the clock by `ms` and runs every timer due by then, in the order they are due. */
  advance(ms: number): void;
  /** The delays (ms from when they were scheduled) of the timers waiting now, in order. */
  readonly waiting: readonly number[];
}

export function createManualTimers(): ManualTimers {
  return new ManualTimersImpl();
}

interface ManualTimer {
  readonly at: number;
  readonly delay: number;
  readonly fn: () => void;
}

class ManualTimersImpl implements ManualTimers {
  private now = 0;
  private timers: readonly ManualTimer[] = [];

  get waiting(): readonly number[] {
    return this.timers.map((t) => t.delay);
  }

  schedule(fn: () => void, ms: number): Disposable {
    const timer: ManualTimer = { at: this.now + ms, delay: ms, fn };
    this.timers = [...this.timers, timer];
    return {
      dispose: () => {
        this.timers = this.timers.filter((t) => t !== timer);
      },
    };
  }

  advance(ms: number): void {
    const until = this.now + ms;
    for (;;) {
      const due = [...this.timers].filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      this.timers = this.timers.filter((t) => t !== due);
      this.now = due.at;
      due.fn();
    }
    this.now = until;
  }
}
