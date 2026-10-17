// Test-only entry point of ops: FakeOps, the double of the ports for tests of interaction and the
// sketcher (N166). It applies nothing: it records what was sent and answers when the test says so,
// replacing its snapshot document with the read model of the answer first, as RemoteSession does.
// dependency-cruiser allows importing it only from tests, so it never reaches the bundle.

import { assert, Emitter } from '@/core';
import type { FeatureId, PartStudioData } from '@/document';
import { aSnapshotDocument } from '@/document/testing';
import type { DocumentOptions, TestDocument } from '@/document/testing';
import type { Operation } from './operation';
import type { DispatchMeta, OperationDispatcher, Transaction, UndoManager } from './ports';

/** One change sent through the ports, in the order of sending. */
export type SentChange =
  | { readonly kind: 'dispatch'; readonly op: Operation; readonly label?: string }
  | { readonly kind: 'begin'; readonly label: string }
  | { readonly kind: 'apply' | 'applyTransient'; readonly op: Operation }
  | { readonly kind: 'commit' | 'abort' | 'undo' | 'redo' };

export interface FakeAnswer {
  /** Default true. */
  readonly ok?: boolean;
  /** The read model of the answer: the document is replaced before the promise resolves. */
  readonly document?: { readonly name?: string; readonly studio?: PartStudioData };
}

export interface FakeOpsOptions extends DocumentOptions {
  readonly canUndo?: boolean;
  readonly canRedo?: boolean;
}

/** OperationDispatcher for tests of interaction and the sketcher: applies nothing, records, waits. */
export interface FakeOps extends OperationDispatcher {
  readonly doc: TestDocument;
  readonly undo: UndoManager & { setFlags(flags: { canUndo: boolean; canRedo: boolean }): void };
  /** All changes sent, in order. */
  readonly sent: readonly SentChange[];
  /** Only the operations (dispatch, apply, applyTransient) in order, batches not unpacked. */
  ops(): readonly Operation[];
  /** The params of the last feature.setParams or feature.add of the feature; undefined = none. */
  lastParams(featureId: FeatureId): unknown;
  /** How many changes wait for an answer (every sent change does, begin and commit too). */
  readonly unanswered: number;
  /** Answers the oldest waiting change; throws when none waits. */
  answer(result?: FakeAnswer): void;
  /** Answers all waiting changes alike (the document is replaced once, before the first promise). */
  answerAll(result?: FakeAnswer): void;
}

export function aFakeOps(options: FakeOpsOptions = {}): FakeOps {
  return new FakeOpsImpl(options);
}

type Flags = { canUndo: boolean; canRedo: boolean };

class FakeOpsImpl implements FakeOps {
  readonly doc: TestDocument;
  readonly undo: FakeOps['undo'];
  private readonly sentChanges: SentChange[] = [];
  private readonly waiting: ((ok: boolean) => void)[] = [];
  private readonly undoEmitter = new Emitter<{ changed: Flags }>();
  private tx: FakeTransaction | null = null;
  private flags: Flags;
  private shown: Flags;

  constructor(options: FakeOpsOptions) {
    const { canUndo = false, canRedo = false, ...documentOptions } = options;
    this.doc = aSnapshotDocument(documentOptions);
    this.flags = { canUndo, canRedo };
    this.shown = this.currentFlags();
    this.undo = this.createUndo();
  }

  get sent(): readonly SentChange[] {
    return this.sentChanges;
  }

  get unanswered(): number {
    return this.waiting.length;
  }

  get inTransaction(): boolean {
    return this.tx !== null;
  }

  dispatch(op: Operation, meta: DispatchMeta = {}): Promise<boolean> {
    assert(this.tx === null, 'dispatch: a transaction is running, use it instead');
    return this.send(
      meta.label === undefined
        ? { kind: 'dispatch', op }
        : { kind: 'dispatch', op, label: meta.label },
    );
  }

  begin(label: string): Transaction {
    assert(this.tx === null, 'begin: a transaction is already running');
    const tx = new FakeTransaction(label, (change) => this.step(change));
    this.tx = tx;
    void this.send({ kind: 'begin', label });
    this.notifyFlags();
    return tx;
  }

  ops(): readonly Operation[] {
    return this.sentChanges.flatMap((change) => ('op' in change ? [change.op] : []));
  }

  lastParams(featureId: FeatureId): unknown {
    for (const op of [...this.ops()].reverse()) {
      if (op.type === 'feature.setParams' && 'featureId' in op && op.featureId === featureId) {
        return 'params' in op ? op.params : undefined;
      }
      if (op.type === 'feature.add' && 'feature' in op && isFeatureOf(op.feature, featureId)) {
        return op.feature.params;
      }
    }
    return undefined;
  }

  answer(result: FakeAnswer = {}): void {
    const next = this.waiting.shift();
    assert(next !== undefined, 'answer: no change waits for an answer');
    if (result.document !== undefined) this.doc.replace(result.document);
    next(result.ok ?? true);
  }

  answerAll(result: FakeAnswer = {}): void {
    const all = this.waiting.splice(0);
    if (result.document !== undefined) this.doc.replace(result.document);
    for (const next of all) next(result.ok ?? true);
  }

  /** A step of the open transaction; commit and abort end it at once. */
  private step(change: SentChange): Promise<boolean> {
    if (change.kind === 'commit' || change.kind === 'abort') {
      this.tx = null;
      const sent = this.send(change);
      this.notifyFlags();
      return sent;
    }
    return this.send(change);
  }

  private send(change: SentChange): Promise<boolean> {
    this.sentChanges.push(change);
    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }

  private currentFlags(): Flags {
    const idle = this.tx === null;
    return { canUndo: this.flags.canUndo && idle, canRedo: this.flags.canRedo && idle };
  }

  private notifyFlags(): void {
    const next = this.currentFlags();
    if (next.canUndo === this.shown.canUndo && next.canRedo === this.shown.canRedo) return;
    this.shown = next;
    this.undoEmitter.emit('changed', next);
  }

  private createUndo(): FakeOps['undo'] {
    return {
      canUndo: () => this.currentFlags().canUndo,
      canRedo: () => this.currentFlags().canRedo,
      undo: () => {
        assert(this.currentFlags().canUndo, 'undo: nothing to undo');
        return this.send({ kind: 'undo' });
      },
      redo: () => {
        assert(this.currentFlags().canRedo, 'redo: nothing to redo');
        return this.send({ kind: 'redo' });
      },
      setFlags: (flags) => {
        this.flags = { ...flags };
        this.notifyFlags();
      },
      events: this.undoEmitter.asSubscribable(),
      dispose: () => undefined,
    };
  }
}

/** The transaction of FakeOps: a call after commit or abort throws (programmer error). */
class FakeTransaction implements Transaction {
  readonly label: string;
  private readonly send: (change: SentChange) => Promise<boolean>;
  private open = true;

  constructor(label: string, send: (change: SentChange) => Promise<boolean>) {
    this.label = label;
    this.send = send;
  }

  apply(op: Operation): Promise<boolean> {
    this.checkOpen('apply');
    return this.send({ kind: 'apply', op });
  }

  applyTransient(op: Operation): Promise<boolean> {
    this.checkOpen('applyTransient');
    return this.send({ kind: 'applyTransient', op });
  }

  commit(): Promise<boolean> {
    this.checkOpen('commit');
    this.open = false;
    return this.send({ kind: 'commit' });
  }

  abort(): Promise<boolean> {
    this.checkOpen('abort');
    this.open = false;
    return this.send({ kind: 'abort' });
  }

  private checkOpen(what: string): void {
    assert(this.open, `Transaction '${this.label}' has ended: cannot ${what}`);
  }
}

function isFeatureOf(
  feature: unknown,
  featureId: FeatureId,
): feature is { readonly id: FeatureId; readonly params: unknown } {
  return (
    typeof feature === 'object' &&
    feature !== null &&
    'id' in feature &&
    feature.id === featureId &&
    'params' in feature
  );
}
