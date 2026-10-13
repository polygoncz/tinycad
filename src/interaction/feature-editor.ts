// The feature dialog (spec 10, "Dialog featury"): create or edit a feature in one
// transaction with a live preview, then OK (commit) or Cancel (abort). The whole dialog
// is one log entry; the document stays the only source of the params.

import { ObservableValue, assert } from '@/core';
import type { IdGenerator, Observable, RegistryReader } from '@/core';
import type {
  BodyId,
  DocumentReader,
  FeatureId,
  FeatureInstance,
  FeatureSchema,
  ParamIssue,
  ParamSpec,
} from '@/document';
import type {
  FeatureAddOp,
  FeatureSetParamsOp,
  OperationDispatcher,
  StudioSetRollbackOp,
  Transaction,
} from '@/ops';
import { OP_VERSION } from '@/ops';
import { nextFeatureName } from './feature-name';
import { bodyOfRef, bodyRefLabel } from './ref-values';

export interface FeatureEditor {
  /** Creates a new feature of the type at the rollback bar and opens an edit session for it. */
  create(type: string): FeatureEditSession;
  /** Opens an existing feature for editing (double click in the tree). */
  edit(featureId: FeatureId): FeatureEditSession;
  readonly current: Observable<FeatureEditSession | null>;
}

/** Created only by FeatureEditor. */
export interface FeatureEditSession {
  readonly mode: 'create' | 'edit';
  readonly featureId: FeatureId;
  readonly schema: FeatureSchema;
  readonly state: Observable<EditState>;
  /** → tx.apply(feature.setParams) */
  setParam(name: string, value: unknown): void;
  /**
   * Removes the item at the index from the value of the param (the × of a chip) → setParam.
   * An index out of range, a non-array value or a closed session do nothing (M11).
   */
  removeRef(name: string, index: number): void;
  focusRefParam(name: string | null): void;
  /** → tx.commit() */
  commit(): void;
  /** → tx.abort() */
  cancel(): void;
}

export interface EditState {
  /** Current values (from the document). */
  readonly params: Readonly<Record<string, unknown>>;
  /** schema.validate(params) */
  readonly issues: readonly ParamIssue[];
  /** In the order of schema.params. */
  readonly fields: readonly FieldState[];
  /** A bodies/topo/region param that accepts the selection. */
  readonly activeRefParam: string | null;
  /** false after commit/cancel. */
  readonly open: boolean;
  /** Name of the feature for the title of the dialog (generated on create). */
  readonly name: string;
}

export interface FieldState {
  readonly name: string;
  /** kind, label, min/max… – the UI picks the control by it. */
  readonly spec: ParamSpec;
  readonly value: unknown;
  /** The first ParamIssue with param === name; ui translates its code (ADR 0014). */
  readonly issue: ParamIssue | null;
  /** name === activeRefParam */
  readonly active: boolean;
  /** The chips of a 'bodies' param, one per item of the value; null for the other kinds (M11). */
  readonly refs: readonly FieldRef[] | null;
}

/** One item of the value of a 'bodies' param, as its chip shows it. */
export interface FieldRef {
  /** Position of the item in the value. */
  readonly index: number;
  /** null for an item that is not a body reference of the right shape. */
  readonly body: BodyId | null;
  /** Name from the document only (bodyRefLabel); null = a missing body. */
  readonly label: string | null;
}

export function createFeatureEditor(deps: {
  doc: DocumentReader;
  ops: OperationDispatcher;
  schemas: RegistryReader<FeatureSchema>;
  ids: IdGenerator;
  /** Translates schema.label for the name of a new feature (ADR 0014); identity by default. */
  translate?: (key: string) => string;
}): FeatureEditor {
  const { doc, ops, schemas, ids } = deps;
  const translate = deps.translate ?? ((key: string) => key);
  const current = new ObservableValue<FeatureEditSession | null>(null);

  function checkCanOpen(what: string): void {
    assert(current.get() === null, `${what}: a feature edit session is already open`);
    assert(!ops.inTransaction, `${what}: a transaction is running`);
  }

  /** Begins the transaction and runs `start` in it; a failing start aborts it again. */
  function begin(label: string, start: (tx: Transaction) => void): Transaction {
    const tx = ops.begin(label);
    try {
      start(tx);
    } catch (e) {
      tx.abort();
      throw e;
    }
    return tx;
  }

  function open(
    mode: FeatureEditSession['mode'],
    featureId: FeatureId,
    schema: FeatureSchema,
    tx: Transaction,
  ): FeatureEditSession {
    const session = createSession({
      doc,
      ops,
      tx,
      mode,
      featureId,
      schema,
      onClose: () => {
        current.set(null);
      },
    });
    current.set(session);
    return session;
  }

  return {
    current: current.asObservable(),
    create(type) {
      checkCanOpen('create');
      const schema = schemas.get(type);
      const feature: FeatureInstance = {
        // Ids are minted here from the generator, the one trusted place for a new FeatureId.
        id: ids.next() as FeatureId,
        type,
        typeVersion: schema.version,
        // The name is plain text in the current language; a later switch does not rename it.
        name: nextFeatureName(doc.studio, translate(schema.label)),
        // FeatureInstance.params is Readonly<P> with P = unknown, which rejects a plain unknown.
        params: schema.defaults() as FeatureInstance['params'],
        suppressed: false,
      };
      // The label of the transaction stays the key, translated only when shown (ADR 0014).
      const tx = begin(schema.label, (t) => {
        // Inserting at the bar moves the bar behind the new feature (Q068).
        const add: FeatureAddOp = {
          type: 'feature.add',
          v: OP_VERSION['feature.add'],
          feature,
          index: doc.studio.rollbackIndex,
        };
        t.apply(add);
      });
      return open('create', feature.id, schema, tx);
    },
    edit(featureId) {
      checkCanOpen('edit');
      const feature = doc.feature(featureId);
      assert(feature !== undefined, `edit: unknown feature '${featureId}'`);
      const schema = schemas.get(feature.type);
      // A translation key; the feature name does not belong in it (ADR 0014).
      const tx = begin('feature.edit', (t) => {
        // The bar sits right behind the edited feature for the session only (Q018).
        const index = doc.indexOf(featureId) + 1;
        if (doc.studio.rollbackIndex === index) return;
        const move: StudioSetRollbackOp = {
          type: 'studio.setRollback',
          v: OP_VERSION['studio.setRollback'],
          index,
        };
        t.applyTransient(move);
      });
      return open('edit', featureId, schema, tx);
    },
  };
}

const REF_KINDS: ReadonlySet<ParamSpec['kind']> = new Set(['bodies', 'topo', 'region']);
const NO_PARAMS: Readonly<Record<string, unknown>> = Object.freeze({});

function createSession(deps: {
  doc: DocumentReader;
  ops: OperationDispatcher;
  tx: Transaction;
  mode: FeatureEditSession['mode'];
  featureId: FeatureId;
  schema: FeatureSchema;
  onClose: () => void;
}): FeatureEditSession {
  const { doc, ops, tx, mode, featureId, schema, onClose } = deps;
  // A new feature takes the selection into its first reference param right away; editing an
  // existing one starts without (spec 10, R19).
  let activeRefParam: string | null = mode === 'create' ? firstRefParam(schema) : null;
  let open = true;

  /** The chips of a 'bodies' value; `prev` is reused when nothing in them changed. */
  function refsOf(value: unknown, prev: readonly FieldRef[] | null): readonly FieldRef[] {
    const items: readonly unknown[] = Array.isArray(value) ? value : [];
    const refs = items.map((item, index): FieldRef => {
      const body = bodyOfRef(item);
      return Object.freeze({ index, body, label: body === null ? null : bodyRefLabel(doc, body) });
    });
    return prev !== null && sameRefs(prev, refs) ? prev : Object.freeze(refs);
  }

  const state = new ObservableValue<EditState>(buildState(null));
  // Labels of the chips come from the document (names of features, body metadata), so the
  // snapshot follows every change of it while the session is open.
  const unsubscribeDoc = doc.events.on('changed', refresh);

  /** The name of the feature in the document; the last known one once it is gone. */
  function readName(prev: EditState | null): string {
    return doc.feature(featureId)?.name ?? prev?.name ?? '';
  }

  /** The params of the feature in the document; the last known ones once it is gone. */
  function readParams(prev: EditState | null): Readonly<Record<string, unknown>> {
    const params = doc.feature(featureId)?.params;
    if (params === undefined) return prev?.params ?? NO_PARAMS;
    return isRecord(params) ? params : NO_PARAMS;
  }

  /** A new snapshot from the document, reusing everything unchanged from `prev`. */
  function buildState(prev: EditState | null): EditState {
    const params = readParams(prev);
    const freshIssues = schema.validate(params);
    const issues =
      prev !== null && sameIssues(prev.issues, freshIssues)
        ? prev.issues
        : Object.freeze(freshIssues.map(freezeIssue));
    const fields = Object.entries(schema.params).map(([name, spec], i): FieldState => {
      const old = prev?.fields[i];
      const field: FieldState = {
        name,
        spec,
        value: params[name],
        issue: issues.find((issue) => issue.param === name) ?? null,
        active: name === activeRefParam,
        refs: spec.kind === 'bodies' ? refsOf(params[name], old?.refs ?? null) : null,
      };
      return old !== undefined && sameField(old, field) ? old : Object.freeze(field);
    });
    const sameFields =
      prev !== null &&
      prev.fields.length === fields.length &&
      fields.every((f, i) => f === prev.fields[i]);
    return Object.freeze({
      params,
      issues,
      fields: sameFields ? prev.fields : Object.freeze(fields),
      activeRefParam,
      open,
      name: readName(prev),
    });
  }

  /** Publishes a new snapshot unless nothing has changed. */
  function refresh(): void {
    const prev = state.get();
    const next = buildState(prev);
    const unchanged =
      next.params === prev.params &&
      next.issues === prev.issues &&
      next.fields === prev.fields &&
      next.activeRefParam === prev.activeRefParam &&
      next.open === prev.open &&
      next.name === prev.name;
    if (!unchanged) state.set(next);
  }

  function checkOpen(what: string): void {
    assert(open, `${what}: the feature edit session is closed`);
  }

  /** Closes the session once the transaction has really ended, even if subscribers threw. */
  function closeAfter(end: () => void): void {
    try {
      end();
    } finally {
      if (!ops.inTransaction) {
        unsubscribeDoc();
        open = false;
        activeRefParam = null;
        refresh();
        onClose();
      }
    }
  }

  /** → tx.apply(feature.setParams) */
  function setParam(name: string, value: unknown): void {
    checkOpen('setParam');
    assert(Object.hasOwn(schema.params, name), `setParam: unknown param '${name}'`);
    const params = readParams(state.get());
    if (Object.hasOwn(params, name) && Object.is(params[name], value)) return;
    const op: FeatureSetParamsOp = {
      type: 'feature.setParams',
      v: OP_VERSION['feature.setParams'],
      featureId,
      // The params are written in the shape of this schema version (Q035).
      typeVersion: schema.version,
      params: { ...params, [name]: value },
    };
    // A failing handler throws here, before anything changed: the session stays as it was.
    tx.apply(op);
    refresh();
  }

  return {
    mode,
    featureId,
    schema,
    state: state.asObservable(),
    setParam,
    removeRef(name, index) {
      if (!open) return;
      assert(Object.hasOwn(schema.params, name), `removeRef: unknown param '${name}'`);
      const value = readParams(state.get())[name];
      if (!Array.isArray(value) || !Number.isInteger(index)) return;
      const items: readonly unknown[] = value;
      if (index < 0 || index >= items.length) return;
      setParam(name, Object.freeze(items.toSpliced(index, 1)));
    },
    focusRefParam(name) {
      checkOpen('focusRefParam');
      if (name !== null) {
        const spec = schema.params[name];
        assert(
          spec !== undefined && REF_KINDS.has(spec.kind),
          `focusRefParam: '${name}' is not a reference param`,
        );
      }
      activeRefParam = name;
      refresh();
    },
    commit() {
      checkOpen('commit');
      closeAfter(() => {
        tx.commit();
      });
    },
    cancel() {
      checkOpen('cancel');
      closeAfter(() => {
        tx.abort();
      });
    },
  };
}

/** The first bodies, topo or region param in the order of the schema, or null. */
function firstRefParam(schema: FeatureSchema): string | null {
  const found = Object.entries(schema.params).find(([, spec]) => REF_KINDS.has(spec.kind));
  return found === undefined ? null : found[0];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A frozen copy, its params included: issues come from the plugin's validate. */
function freezeIssue(issue: ParamIssue): ParamIssue {
  const { params, ...rest } = issue;
  return Object.freeze(
    params === undefined ? { ...rest } : { ...rest, params: Object.freeze({ ...params }) },
  );
}

function sameIssues(a: readonly ParamIssue[], b: readonly ParamIssue[]): boolean {
  return a.length === b.length && a.every((issue, i) => sameIssue(issue, b[i] ?? null));
}

function sameIssue(a: ParamIssue | null, b: ParamIssue | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.param === b.param && a.code === b.code && sameIssueParams(a.params, b.params);
}

function sameIssueParams(a: ParamIssue['params'], b: ParamIssue['params']): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && Object.is(a[key], b[key]))
  );
}

function sameField(a: FieldState, b: FieldState): boolean {
  return (
    a.name === b.name &&
    a.spec === b.spec &&
    Object.is(a.value, b.value) &&
    sameIssue(a.issue, b.issue) &&
    a.active === b.active &&
    a.refs === b.refs
  );
}

function sameRefs(a: readonly FieldRef[], b: readonly FieldRef[]): boolean {
  return (
    a.length === b.length &&
    a.every((ref, i) => {
      const other = b[i];
      return other !== undefined && ref.body === other.body && ref.label === other.label;
    })
  );
}
