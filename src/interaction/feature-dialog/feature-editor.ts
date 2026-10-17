// The feature dialog (spec 10, "Dialog featury"): create or edit a feature in one
// transaction with a live preview, then OK (commit) or Cancel (abort). The whole dialog
// is one log entry. The document (the read model of the server) is the source of the params,
// except for the values the user entered and the server has not taken yet (N164).

import { ObservableValue, assert } from '@/core';
import type { IdGenerator, Observable, RegistryReader } from '@/core';
import type {
  DocumentReader,
  FeatureId,
  FeatureInstance,
  FeatureSchema,
  ParamIssue,
  ParamSpec,
} from '@/document';
import { NO_VARIABLES, evaluateParams, isParamVisible } from '@/document';
import type {
  FeatureAddOp,
  FeatureSetParamsOp,
  Operation,
  OperationDispatcher,
  StudioSetRollbackOp,
  Transaction,
} from '@/ops';
import { OP_VERSION } from '@/ops';
import { nextFeatureName } from '../feature-name';
import { behaviorOf, isRefParamSpec, refBehaviorOf } from './ref-kinds';
import type { FieldRef, RefText } from './ref-kinds';
import type { RegenStatusPort } from '../regen-status-port';

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
   * Several params with one feature.setParams (M12, the sketcher). Every key must be a param of
   * the schema, otherwise it throws and applies nothing; all values the same → nothing.
   */
  setParams(patch: Readonly<Record<string, unknown>>): void;
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
  /**
   * Current values: what the user entered while the server has not taken the last change sent by
   * this session (N164), otherwise the feature in the document.
   */
  readonly params: Readonly<Record<string, unknown>>;
  /** The issues of evaluateParams(schema, params) (M20). */
  readonly issues: readonly ParamIssue[];
  /** In the order of schema.params. */
  readonly fields: readonly FieldState[];
  /** A visible bodies/topo/region/planes/axis param that accepts the selection. */
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
  /**
   * The chips of a 'bodies' (M11) or a 'topo' (D5 of M19.1) param, one per item of the value; null
   * for the other kinds.
   */
  readonly refs: readonly FieldRef[] | null;
  /**
   * !isParamVisible(spec, …) over the evaluated params, the raw ones while they have issues
   * (M13, M20): the dialog does not draw the field.
   */
  readonly hidden: boolean;
  /** spec.group, the translation key of the section heading (M13). */
  readonly group: string | null;
  /**
   * The group key at the first visible field of a group other than that of the previous visible
   * field, null otherwise; fields of kind 'data' (no control) are skipped like hidden ones (M13).
   */
  readonly heading: string | null;
  /**
   * The text of the reference of an 'axis' (M13) or a 'planes' (M21) param with a value; null
   * otherwise.
   */
  readonly refText: RefText | null;
}

export function createFeatureEditor(deps: {
  doc: DocumentReader;
  ops: OperationDispatcher;
  schemas: RegistryReader<FeatureSchema>;
  ids: IdGenerator;
  /** Translates schema.label for the name of a new feature (ADR 0014); identity by default. */
  translate?: (key: string) => string;
  /**
   * create preselects the only region of the last sketch (D6 of M19.2); without it nothing is
   * preselected. The selection plays no part: it never holds a region.
   */
  regen?: Pick<RegenStatusPort, 'state'>;
}): FeatureEditor {
  const { doc, ops, schemas, ids, regen } = deps;
  const translate = deps.translate ?? ((key: string) => key);
  const current = new ObservableValue<FeatureEditSession | null>(null);

  function checkCanOpen(what: string): void {
    assert(current.get() === null, `${what}: a feature edit session is already open`);
    assert(!ops.inTransaction, `${what}: a transaction is running`);
  }

  function open(
    mode: FeatureEditSession['mode'],
    featureId: FeatureId,
    schema: FeatureSchema,
    tx: Transaction,
    add: FeatureAddOp | null,
  ): FeatureEditSession {
    const session = createSession({
      doc,
      ops,
      tx,
      mode,
      featureId,
      schema,
      add,
      onClose: () => {
        current.set(null);
      },
    });
    current.set(session);
    return session;
  }

  /**
   * The defaults of a new feature (D6 of M19.2): when its first auto-focused param is a region
   * param, nothing is selected and the last sketch of the last regeneration has exactly one
   * region, the param gets that region, like in Fusion. By the kind of the param, so it holds for
   * every plugin with a region param (Extrude, Revolve).
   */
  function initialParams(schema: FeatureSchema): unknown {
    const defaults = schema.defaults();
    if (regen === undefined || !isRecord(defaults)) return defaults;
    const param = firstRefParam(schema, defaults);
    const spec = param === null ? undefined : schema.params[param];
    const behavior = spec === undefined ? null : refBehaviorOf(spec);
    // What the kind preselects: the table of reference kinds (M20).
    const preselected = behavior === null ? null : behavior.preselect(regen.state.get());
    return param === null || preselected === null
      ? defaults
      : { ...defaults, [param]: preselected.value };
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
        params: initialParams(schema) as FeatureInstance['params'],
        suppressed: false,
      };
      // The label of the transaction stays the key, translated only when shown (ADR 0014).
      const tx = ops.begin(schema.label);
      // Inserting at the bar moves the bar behind the new feature (Q068).
      const add: FeatureAddOp = {
        type: 'feature.add',
        v: OP_VERSION['feature.add'],
        feature,
        index: doc.studio.rollbackIndex,
      };
      return open('create', feature.id, schema, tx, add);
    },
    edit(featureId) {
      checkCanOpen('edit');
      const feature = doc.feature(featureId);
      assert(feature !== undefined, `edit: unknown feature '${featureId}'`);
      const schema = schemas.get(feature.type);
      // A translation key; the feature name does not belong in it (ADR 0014).
      const tx = ops.begin('feature.edit');
      // The bar sits right behind the edited feature for the session only (Q018); not a value of
      // the user, so it does not touch the entered values.
      const index = doc.indexOf(featureId) + 1;
      if (doc.studio.rollbackIndex !== index) {
        const move: StudioSetRollbackOp = {
          type: 'studio.setRollback',
          v: OP_VERSION['studio.setRollback'],
          index,
        };
        void tx.applyTransient(move);
      }
      return open('edit', featureId, schema, tx, null);
    },
  };
}

const NO_PARAMS: Readonly<Record<string, unknown>> = Object.freeze({});

/** The values the user entered and the server has not taken yet (N164). */
interface Draft {
  readonly params: Readonly<Record<string, unknown>>;
  readonly name: string | null;
}

function createSession(deps: {
  doc: DocumentReader;
  ops: OperationDispatcher;
  tx: Transaction;
  mode: FeatureEditSession['mode'];
  featureId: FeatureId;
  schema: FeatureSchema;
  /** The feature.add of create, sent at once: its params and name are the first entered values. */
  add: FeatureAddOp | null;
  onClose: () => void;
}): FeatureEditSession {
  const { doc, ops, tx, mode, featureId, schema, add, onClose } = deps;
  let activeRefParam: string | null = null;
  let open = true;
  let draft: Draft | null =
    add === null
      ? null
      : {
          params: isRecord(add.feature.params) ? add.feature.params : NO_PARAMS,
          name: add.feature.name,
        };
  /** The number of the last change this session sent. */
  let lastSent = 0;

  /**
   * Sends the change; when the server takes the last one sent, the entered values go and the
   * state reads the document again (which already shows the read model of that answer, N165).
   * An answer to an older change or a refusal leaves them.
   */
  function send(op: Operation): void {
    const n = ++lastSent;
    void tx.apply(op).then((ok) => {
      if (open && ok && n === lastSent) {
        draft = null;
        refresh();
      }
    });
  }

  /**
   * FieldState.refs: the chips of the kind (the table of reference kinds, M20), null for a kind
   * without chips; `prev` is reused when nothing in them changed.
   */
  function chipsOf(
    spec: ParamSpec,
    value: unknown,
    prev: readonly FieldRef[] | null,
  ): readonly FieldRef[] | null {
    const refs = isRefParamSpec(spec) ? behaviorOf(spec).chips(value, spec, doc) : null;
    return refs !== null && prev !== null && sameRefs(prev, refs) ? prev : refs;
  }

  // A new feature takes the selection into its first visible reference param right away; editing
  // an existing one starts without (spec 10, R19).
  if (mode === 'create') activeRefParam = firstRefParam(schema, readParams(null));
  const state = new ObservableValue<EditState>(buildState(null));
  // Labels of the chips come from the document (names of features, body metadata), so the
  // snapshot follows every change of it while the session is open.
  const unsubscribeDoc = doc.events.on('changed', refresh);

  /** The name of the feature in the document, the entered one, the last known one once it is gone. */
  function readName(prev: EditState | null): string {
    return doc.feature(featureId)?.name ?? draft?.name ?? prev?.name ?? '';
  }

  /** The entered params, those of the feature in the document, the last known ones once it is gone. */
  function readParams(prev: EditState | null): Readonly<Record<string, unknown>> {
    if (draft !== null) return draft.params;
    const params = doc.feature(featureId)?.params;
    if (params === undefined) return prev?.params ?? NO_PARAMS;
    return isRecord(params) ? params : NO_PARAMS;
  }

  /**
   * FieldState.refText: the text of the kind (the table of reference kinds, M20), null for a kind
   * without one or without a value. `prev` is reused when equal.
   */
  function refTextOf(spec: ParamSpec, value: unknown, prev: RefText | null): RefText | null {
    const next = refBehaviorOf(spec)?.refText(value, doc) ?? null;
    return prev !== null && next !== null && sameRefText(prev, next) ? prev : next;
  }

  /** A new snapshot from the document, reusing everything unchanged from `prev`. */
  function buildState(prev: EditState | null): EditState {
    const params = readParams(prev);
    // The raw params stay in the state and are what the editor writes; issues and visibility come
    // from the evaluated ones (M20).
    const evaluation = evaluateParams(schema, params, NO_VARIABLES);
    const visibleFrom = evaluation.params ?? params;
    // A change of the params that hides the focused param drops the focus (spec 10, M13).
    if (activeRefParam !== null) {
      const spec = schema.params[activeRefParam];
      if (spec === undefined || !isParamVisible(spec, visibleFrom)) activeRefParam = null;
    }
    const freshIssues = evaluation.issues;
    const issues =
      prev !== null && sameIssues(prev.issues, freshIssues)
        ? prev.issues
        : Object.freeze(freshIssues.map(freezeIssue));
    let lastGroup: string | null = null;
    const fields = Object.entries(schema.params).map(([name, spec], i): FieldState => {
      const old = prev?.fields[i];
      const hidden = !isParamVisible(spec, visibleFrom);
      const group = spec.group ?? null;
      let heading: string | null = null;
      if (!hidden && spec.kind !== 'data') {
        if (group !== lastGroup) heading = group;
        lastGroup = group;
      }
      const field: FieldState = {
        name,
        spec,
        value: params[name],
        issue: issues.find((issue) => issue.param === name) ?? null,
        active: name === activeRefParam,
        refs: chipsOf(spec, params[name], old?.refs ?? null),
        hidden,
        group,
        heading,
        refText: refTextOf(spec, params[name], old?.refText ?? null),
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

  /**
   * Closes the session once the transaction has really ended, even if subscribers threw: of the
   * end, of the closed snapshot or of current. Their error goes on after the cleanup.
   */
  function closeAfter(end: () => void): void {
    try {
      end();
    } finally {
      if (!ops.inTransaction) {
        unsubscribeDoc();
        open = false;
        activeRefParam = null;
        try {
          refresh();
        } finally {
          onClose();
        }
      }
    }
  }

  /** → tx.apply(feature.setParams) with the patch over the current params. */
  function applyPatch(what: string, patch: Readonly<Record<string, unknown>>): void {
    checkOpen(what);
    const names = Object.keys(patch);
    for (const name of names) {
      assert(Object.hasOwn(schema.params, name), `${what}: unknown param '${name}'`);
    }
    const params = readParams(state.get());
    const same = names.every(
      (name) => Object.hasOwn(params, name) && Object.is(params[name], patch[name]),
    );
    if (same) return;
    const next = Object.freeze({ ...params, ...patch });
    const op: FeatureSetParamsOp = {
      type: 'feature.setParams',
      v: OP_VERSION['feature.setParams'],
      featureId,
      // The params are written in the shape of this schema version (Q035).
      typeVersion: schema.version,
      params: next,
    };
    // The entered values are visible at once, before the answer (N164).
    draft = { params: next, name: readName(state.get()) };
    refresh();
    send(op);
  }

  function setParam(name: string, value: unknown): void {
    applyPatch('setParam', { [name]: value });
  }

  if (add !== null) send(add);

  return {
    mode,
    featureId,
    schema,
    state: state.asObservable(),
    setParam,
    setParams(patch) {
      applyPatch('setParams', patch);
    },
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
          spec !== undefined && refBehaviorOf(spec)?.focusable === true,
          `focusRefParam: '${name}' is not a reference param`,
        );
        const visibleFrom = visibilityParams(schema, readParams(state.get()));
        assert(isParamVisible(spec, visibleFrom), `focusRefParam: '${name}' is hidden`);
      }
      activeRefParam = name;
      refresh();
    },
    commit() {
      checkOpen('commit');
      closeAfter(() => {
        void tx.commit();
      });
    },
    cancel() {
      checkOpen('cancel');
      closeAfter(() => {
        void tx.abort();
      });
    },
  };
}

/**
 * The first visible param of a kind focused on create (autoFocus of the table of reference kinds,
 * M20) in the order of the schema, or null.
 */
function firstRefParam(
  schema: FeatureSchema,
  params: Readonly<Record<string, unknown>>,
): string | null {
  const visibleFrom = visibilityParams(schema, params);
  const found = Object.entries(schema.params).find(
    ([, spec]) => refBehaviorOf(spec)?.autoFocus === true && isParamVisible(spec, visibleFrom),
  );
  return found === undefined ? null : found[0];
}

/**
 * The params visibility is computed from (M20): the evaluated ones, the raw ones while they have
 * issues, as before evaluation existed. With expressions Q003 decides.
 */
function visibilityParams(
  schema: FeatureSchema,
  params: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return evaluateParams(schema, params, NO_VARIABLES).params ?? params;
}

function sameRefText(a: RefText, b: RefText): boolean {
  const keys = Object.keys(a.params);
  return (
    a.key === b.key &&
    keys.length === Object.keys(b.params).length &&
    keys.every((key) => a.params[key] === b.params[key])
  );
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
    a.refs === b.refs &&
    a.hidden === b.hidden &&
    a.group === b.group &&
    a.heading === b.heading &&
    a.refText === b.refText
  );
}

function sameRefs(a: readonly FieldRef[], b: readonly FieldRef[]): boolean {
  return (
    a.length === b.length &&
    a.every((ref, i) => {
      const other = b[i];
      return (
        other !== undefined &&
        ref.body === other.body &&
        ref.label === other.label &&
        sameOptionalRefText(ref.text, other.text) &&
        ref.missing === other.missing
      );
    })
  );
}

function sameOptionalRefText(a: RefText | null, b: RefText | null): boolean {
  if (a === null || b === null) return a === b;
  return sameRefText(a, b);
}
