import { describe, expect, it } from 'vitest';
import { ObservableValue, createSequentialIdGenerator } from '@/core';
import { ORIGIN_PLANES, ORIGIN_PLANE_IDS } from '@/document';
import type { FeatureId, PlaneId } from '@/document';
import { GEOMETRIC_CONSTRAINT_KINDS, parseSketchData } from '@/sketch';
import type { SketchConstraint, SketchItemId } from '@/sketch';
import { createFakeSketchGeometry, createFakeTextOutliner, rectangleData } from '@/sketch/testing';
import { createActionRegistry } from '@/interaction';
import type { Mode } from '@/interaction';
import { SKETCH_ACTION_IDS, sketchConstraintActionId } from '@/sketcher/constants';
import { createSketchActions } from '@/sketcher/sketch-actions';
import type { SketchEditor } from '@/sketcher/sketch-editor';
import type { SketchSession, SketchState } from '@/sketcher/sketch-session';

const item = (id: string): SketchItemId => id as SketchItemId; // test ids are trusted

/** The frame of an origin plane. */
function originPlane(id: PlaneId) {
  const found = ORIGIN_PLANES.find((p) => p.id === id);
  if (found === undefined) throw new Error(`no origin plane ${id}`);
  return found.plane;
}

const RECT = rectangleData();

/** A session that records the commands; its state is set by the test. */
function aFakeSession() {
  const calls: (readonly [string, unknown])[] = [];
  const state = new ObservableValue<SketchState>(
    Object.freeze({
      open: true,
      busy: false,
      name: 'Sketch 1',
      entities: RECT.entities,
      constraints: RECT.constraints,
      status: 'ok',
      dof: 4,
      fullyDefined: false,
      statusKey: 'sketch.status.dof',
      statusParams: { n: 4 },
      selection: [],
      hover: null,
      message: null,
      constraintRows: [],
      editingDimension: null,
      dimensions: [],
      patternDimensions: [],
      glyphs: [],
      inference: null,
      numericInput: null,
      planeField: null,
      planeMissing: false,
      constructionMode: false,
    }),
  );
  const record =
    (name: string) =>
    (arg?: unknown): Promise<boolean> => {
      calls.push([name, arg]);
      return Promise.resolve(true);
    };
  const session: SketchSession = {
    featureId: 's1' as FeatureId, // a test id
    plane: new ObservableValue(originPlane(ORIGIN_PLANE_IDS.xy)).asObservable(),
    state: state.asObservable(),
    addGeometry: record('addGeometry'),
    addConstraint: record('addConstraint'),
    setDimension: record('setDimension'),
    remove: record('remove'),
    rewrite: record('rewrite'),
    hits: () => null,
    geometry: createFakeSketchGeometry(),
    toggleConstruction: (ids) => {
      calls.push(['toggleConstruction', ids]);
    },
    setConstructionMode: (on) => {
      calls.push(['setConstructionMode', on]);
      state.set(Object.freeze({ ...state.get(), constructionMode: on }));
    },
    drag: () => undefined,
    endDrag: () => Promise.resolve(),
    previewDimension: () => undefined,
    setInferencePreview: () => undefined,
    setNumericInput: () => undefined,
    moveDimension: () => undefined,
    endMoveDimension: () => undefined,
    setPatternParam: () => false,
    setTextParams: () => Promise.resolve(false),
    setHover: () => undefined,
    select: () => undefined,
    clearSelection: () => undefined,
    clearEditingDimension: () => undefined,
    pickPlane: () => undefined,
    cancelPlanePick: () => false,
    finish: () => {
      calls.push(['finish', undefined]);
    },
    cancel: () => {
      calls.push(['cancel', undefined]);
    },
  };
  const select = (...ids: string[]): void => {
    state.set(Object.freeze({ ...state.get(), selection: Object.freeze(ids.map(item)) }));
  };
  const setBusy = (busy: boolean): void => {
    state.set(Object.freeze({ ...state.get(), busy }));
  };
  /** Adds a lone point m in the middle of the rectangle's bottom edge ab (not one of its ends). */
  const addLonePoint = (): void => {
    const parsed = parseSketchData([...RECT.entities, { kind: 'point', id: 'm', x: 5, y: 0 }], []);
    if (!parsed.ok) throw new Error('invalid test data');
    state.set(Object.freeze({ ...state.get(), entities: parsed.value.entities }));
  };
  /** Adds an xline x through the corners a and c of the rectangle (always construction, M31). */
  const addXLine = (): void => {
    const parsed = parseSketchData(
      [...RECT.entities, { kind: 'xline', id: 'x', p1: 'a', p2: 'c', construction: true }],
      [],
    );
    if (!parsed.ok) throw new Error('invalid test data');
    state.set(Object.freeze({ ...state.get(), entities: parsed.value.entities }));
  };
  return { session, calls, select, setBusy, addLonePoint, addXLine };
}

function setup() {
  const current = new ObservableValue<SketchSession | null>(null);
  const mode = new ObservableValue<Mode>('model');
  const sketches: SketchEditor = {
    current: current.asObservable(),
    mode: mode.asObservable(),
    create: () => expect.fail('create is not expected'),
    planeOf: () => expect.fail('planeOf is not expected'),
    edit: () => expect.fail('edit is not expected'),
    gridSnap: new ObservableValue(true).asObservable(),
    setGridSnap: () => expect.fail('setGridSnap is not expected'),
    showAllConstraints: new ObservableValue(false).asObservable(),
    setShowAllConstraints: () => expect.fail('setShowAllConstraints is not expected'),
    gridStep: () => expect.fail('gridStep is not expected'),
    text: createFakeTextOutliner(),
  };
  const registry = createActionRegistry({ mode: mode.asObservable() });
  const actions = createSketchActions({
    registry,
    sketches,
    ids: createSequentialIdGenerator('c'),
  });
  /** Opens a fake session and switches to the sketch mode like the SketchEditor. */
  const open = () => {
    const fake = aFakeSession();
    current.set(fake.session);
    mode.set('sketch');
    return fake;
  };
  const close = (): void => {
    current.set(null);
    mode.set('model');
  };
  const enabled = (id: string): boolean | undefined =>
    registry.actions.get().find((a) => a.id === id)?.enabled;
  const checked = (id: string): boolean | null | undefined =>
    registry.actions.get().find((a) => a.id === id)?.checked;
  return { registry, actions, open, close, enabled, checked };
}

describe('createSketchActions', () => {
  it('registers finish, cancel, delete, construction and one action per constraint kind', () => {
    const { registry } = setup();

    const states = registry.actions.get();

    expect(states.map((a) => a.id)).toEqual([
      'sketch.finish',
      'sketch.cancel',
      'sketch.delete',
      'sketch.construction',
      ...GEOMETRIC_CONSTRAINT_KINDS.map((k) => `sketch.constraint.${k}`),
    ]);
    expect(states.every((a) => a.modes.length === 1 && a.modes[0] === 'sketch')).toBe(true);
    expect(states.map((a) => [a.id, a.label, a.group, a.shortcut])).toEqual([
      ['sketch.finish', 'sketch.finish', 'sketch', null],
      ['sketch.cancel', 'sketch.cancel', 'sketch', null],
      ['sketch.delete', 'sketch.delete', null, 'Delete'],
      ['sketch.construction', 'sketch.construction', 'sketch.draw', 'Q'],
      ['sketch.constraint.coincident', 'sketch.constraint.coincident', 'sketch.constraint', 'I'],
      ['sketch.constraint.horizontal', 'sketch.constraint.horizontal', 'sketch.constraint', 'H'],
      ['sketch.constraint.vertical', 'sketch.constraint.vertical', 'sketch.constraint', 'V'],
      ['sketch.constraint.parallel', 'sketch.constraint.parallel', 'sketch.constraint', null],
      [
        'sketch.constraint.perpendicular',
        'sketch.constraint.perpendicular',
        'sketch.constraint',
        null,
      ],
      ['sketch.constraint.equal', 'sketch.constraint.equal', 'sketch.constraint', null],
      ['sketch.constraint.tangent', 'sketch.constraint.tangent', 'sketch.constraint', null],
      ['sketch.constraint.midpoint', 'sketch.constraint.midpoint', 'sketch.constraint', null],
      ['sketch.constraint.symmetric', 'sketch.constraint.symmetric', 'sketch.constraint', null],
      ['sketch.constraint.fix', 'sketch.constraint.fix', 'sketch.constraint', null],
    ]);
    expect(SKETCH_ACTION_IDS).toEqual({
      finish: 'sketch.finish',
      cancel: 'sketch.cancel',
      delete: 'sketch.delete',
      construction: 'sketch.construction',
    });
  });

  it('everything is disabled without a session', () => {
    const { registry } = setup();
    expect(registry.actions.get().some((a) => a.enabled)).toBe(false);
  });

  it('finish and cancel are enabled with an open session and call it', () => {
    const { registry, open, close, enabled } = setup();
    const { calls } = open();

    expect(enabled(SKETCH_ACTION_IDS.finish)).toBe(true);
    expect(enabled(SKETCH_ACTION_IDS.cancel)).toBe(true);
    registry.run(SKETCH_ACTION_IDS.finish);
    registry.run(SKETCH_ACTION_IDS.cancel);
    expect(calls.map(([name]) => name)).toEqual(['finish', 'cancel']);

    close();
    expect(enabled(SKETCH_ACTION_IDS.finish)).toBe(false);
  });

  it('finish is disabled while the session is busy, cancel is not (D8)', () => {
    const { registry, open, enabled } = setup();
    const { calls, setBusy } = open();

    setBusy(true);

    expect(enabled(SKETCH_ACTION_IDS.finish)).toBe(false);
    expect(enabled(SKETCH_ACTION_IDS.cancel)).toBe(true);
    expect(registry.run(SKETCH_ACTION_IDS.finish)).toBe(false);
    expect(calls).toEqual([]);
    setBusy(false);
    expect(enabled(SKETCH_ACTION_IDS.finish)).toBe(true);
  });

  it('delete is enabled with a selection and removes it (Delete and Backspace)', () => {
    const { registry, open, enabled } = setup();
    const { calls, select } = open();
    expect(enabled(SKETCH_ACTION_IDS.delete)).toBe(false);

    select('ab', 'h1');
    expect(enabled(SKETCH_ACTION_IDS.delete)).toBe(true);
    const key = (k: string) => ({
      key: k,
      mods: { shift: false, alt: false, mod: false },
      inTextField: false,
    });
    expect(registry.handleKey(key('Delete'))).toBe(true);
    expect(registry.handleKey(key('Backspace'))).toBe(true);

    expect(calls).toEqual([
      ['remove', ['ab', 'h1']],
      ['remove', ['ab', 'h1']],
    ]);
  });

  it('construction is enabled with an open session (M31)', () => {
    const { open, close, enabled } = setup();
    expect(enabled(SKETCH_ACTION_IDS.construction)).toBe(false);

    open();
    expect(enabled(SKETCH_ACTION_IDS.construction)).toBe(true);
    close();
    expect(enabled(SKETCH_ACTION_IDS.construction)).toBe(false);
  });

  it('construction with a curve in the selection toggles it', () => {
    const { registry, open, checked } = setup();
    const { calls, select } = open();

    select('a', 'bc');
    registry.run(SKETCH_ACTION_IDS.construction);

    expect(calls).toEqual([['toggleConstruction', ['a', 'bc']]]);
    expect(checked(SKETCH_ACTION_IDS.construction)).toBe(false);
  });

  it('construction without a curve in the selection switches the construction mode (M31)', () => {
    const { registry, open, checked } = setup();
    const { calls, select } = open();
    expect(checked(SKETCH_ACTION_IDS.construction)).toBe(false);

    registry.run(SKETCH_ACTION_IDS.construction);
    expect(checked(SKETCH_ACTION_IDS.construction)).toBe(true);
    select('a', 'h1');
    registry.run(SKETCH_ACTION_IDS.construction);

    expect(calls).toEqual([
      ['setConstructionMode', true],
      ['setConstructionMode', false],
    ]);
    expect(checked(SKETCH_ACTION_IDS.construction)).toBe(false);
  });

  it('construction with only an xline and points selected switches the mode (M31)', () => {
    const { registry, open, checked } = setup();
    const { calls, select, addXLine } = open();
    addXLine();

    // An xline is always construction: it cannot be toggled, so it does not count as a curve.
    select('x', 'a');
    registry.run(SKETCH_ACTION_IDS.construction);
    expect(calls).toEqual([['setConstructionMode', true]]);
    expect(checked(SKETCH_ACTION_IDS.construction)).toBe(true);

    // With a togglable curve beside it the selection is toggled as before.
    select('x', 'bc');
    registry.run(SKETCH_ACTION_IDS.construction);
    expect(calls).toEqual([
      ['setConstructionMode', true],
      ['toggleConstruction', ['x', 'bc']],
    ]);
  });

  it('Q runs construction; checked is false without a session', () => {
    const { registry, open, close, checked } = setup();
    const { calls } = open();

    expect(
      registry.handleKey({
        key: 'q',
        mods: { shift: false, alt: false, mod: false },
        inTextField: false,
      }),
    ).toBe(true);
    expect(calls).toEqual([['setConstructionMode', true]]);
    expect(checked(SKETCH_ACTION_IDS.construction)).toBe(true);

    close();
    expect(checked(SKETCH_ACTION_IDS.construction)).toBe(false);
  });

  it('a constraint action is enabled when constraintFor fits the selected entities', () => {
    const { open, enabled } = setup();
    const { select } = open();
    const horizontal = sketchConstraintActionId('horizontal');
    const coincident = sketchConstraintActionId('coincident');
    const parallel = sketchConstraintActionId('parallel');

    select('ab');
    expect(enabled(horizontal)).toBe(true);
    expect(enabled(coincident)).toBe(false);
    select('a', 'c');
    expect(enabled(coincident)).toBe(true);
    // Two points: horizontal aligns them (hAlign).
    expect(enabled(horizontal)).toBe(true);
    select('a', 'ab');
    expect(enabled(coincident)).toBe(false);
    // Constraints in the selection are left out: two lines and a constraint are two lines.
    select('ab', 'h1', 'cd');
    expect(enabled(parallel)).toBe(true);
  });

  it('a constraint action adds the constraint with a new id, in selection order', () => {
    const { registry, open } = setup();
    const { calls, select } = open();

    select('cd', 'ab');
    registry.run(sketchConstraintActionId('parallel'));
    select('a');
    registry.handleKey({
      key: 'i',
      mods: { shift: false, alt: false, mod: false },
      inTextField: false,
    });

    const added = calls.map(([, c]) => c as SketchConstraint); // only addConstraint was called
    expect(added).toEqual([{ kind: 'parallel', a: 'cd', b: 'ab', id: 'c1' }]);
    select('ab');
    registry.handleKey({
      key: 'h',
      mods: { shift: false, alt: false, mod: false },
      inTextField: false,
    });
    expect(calls.at(-1)).toEqual(['addConstraint', { kind: 'horizontal', line: 'ab', id: 'c2' }]);
  });

  it('midpoint is enabled for a point and a line and adds the constraint', () => {
    const { registry, open, enabled } = setup();
    const { calls, select, addLonePoint } = open();
    const midpoint = sketchConstraintActionId('midpoint');

    select('a', 'ab');
    expect(enabled(midpoint)).toBe(false);
    addLonePoint();
    select('ab', 'm');
    expect(enabled(midpoint)).toBe(true);
    registry.run(midpoint);
    expect(calls.at(-1)).toEqual([
      'addConstraint',
      { kind: 'midpoint', point: 'm', line: 'ab', id: 'c1' },
    ]);
  });

  it('symmetric is enabled for two points and an axis line and adds the constraint (M36)', () => {
    const { registry, open, enabled } = setup();
    const { calls, select } = open();
    const symmetric = sketchConstraintActionId('symmetric');

    select('a', 'b');
    expect(enabled(symmetric)).toBe(false);
    // a and b are not points of cd.
    select('a', 'b', 'cd');
    expect(enabled(symmetric)).toBe(true);
    registry.run(symmetric);
    expect(calls.at(-1)).toEqual([
      'addConstraint',
      { kind: 'symmetric', a: 'a', b: 'b', axis: 'cd', id: 'c1' },
    ]);
  });

  it('coincident of a point and a line adds pointOnCurve, horizontal of two points hAlign', () => {
    const { registry, open } = setup();
    const { calls, select, addLonePoint } = open();
    addLonePoint();

    select('m', 'cd');
    registry.run(sketchConstraintActionId('coincident'));
    select('m', 'c');
    registry.run(sketchConstraintActionId('horizontal'));
    expect(calls).toEqual([
      ['addConstraint', { kind: 'pointOnCurve', point: 'm', curve: 'cd', id: 'c1' }],
      ['addConstraint', { kind: 'hAlign', a: 'm', b: 'c', id: 'c2' }],
    ]);
  });

  it('follows a newly opened session', () => {
    const { open, close, enabled } = setup();
    open().select('ab');
    close();
    const second = open();
    expect(enabled(SKETCH_ACTION_IDS.delete)).toBe(false);
    second.select('ab');
    expect(enabled(SKETCH_ACTION_IDS.delete)).toBe(true);
  });

  it('stops following after dispose', () => {
    const { actions, open, enabled } = setup();
    const { select } = open();

    actions.dispose();
    select('ab');

    expect(enabled(SKETCH_ACTION_IDS.delete)).toBe(false);
  });
});
