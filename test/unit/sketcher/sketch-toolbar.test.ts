import { describe, expect, it } from 'vitest';
import { ObservableValue, createSequentialIdGenerator } from '@/core';
import { createActionRegistry, createToolbarModel } from '@/interaction';
import type { Mode } from '@/interaction';
import { GEOMETRIC_CONSTRAINT_KINDS } from '@/sketch';
import { SKETCH_ACTION_IDS, sketchConstraintActionId } from '@/sketcher/constants';
import { createSketchActions } from '@/sketcher/sketch-actions';
import type { SketchEditor } from '@/sketcher/sketch-editor';
import type { SketchSession } from '@/sketcher/sketch-session';
import { SKETCH_TOOLBAR } from '@/sketcher/sketch-toolbar';
import { createSketchTools } from '@/sketcher/sketch-tools';

// The sketcher's part of the Toolbar (M20): the toolbar model of interaction over the real tools
// and actions of the sketcher with SKETCH_TOOLBAR, in the sketch mode.

function setup() {
  const mode = new ObservableValue<Mode>('model');
  const sketches: SketchEditor = {
    current: new ObservableValue<SketchSession | null>(null).asObservable(),
    mode: mode.asObservable(),
    create: () => expect.fail('create is not expected'),
    planeOf: () => expect.fail('planeOf is not expected'),
    edit: () => expect.fail('edit is not expected'),
    gridSnap: new ObservableValue(true).asObservable(),
    setGridSnap: () => expect.fail('setGridSnap is not expected'),
    showAllConstraints: new ObservableValue(false).asObservable(),
    setShowAllConstraints: () => expect.fail('setShowAllConstraints is not expected'),
    gridStep: () => expect.fail('gridStep is not expected'),
  };
  const registry = createActionRegistry({ mode: mode.asObservable() });
  createSketchActions({ registry, sketches, ids: createSequentialIdGenerator('c') });
  const toolbar = createToolbarModel({
    tools: {
      active: new ObservableValue('sketch.select').asObservable(),
      activate: () => undefined,
    },
    toolList: createSketchTools({ sketches }),
    actions: registry,
    locked: new ObservableValue(false).asObservable(),
    mode: mode.asObservable(),
    contributions: [SKETCH_TOOLBAR],
  });
  return { toolbar, mode };
}

describe('SKETCH_TOOLBAR', () => {
  it('is the frozen contribution of the sketch mode', () => {
    expect(SKETCH_TOOLBAR.mode).toBe('sketch');
    expect(Object.isFrozen(SKETCH_TOOLBAR)).toBe(true);
    expect(Object.isFrozen(SKETCH_TOOLBAR.groupOrder)).toBe(true);
  });

  it('in the sketch mode: select, draw, modify, constrain, finish with the tools and actions', () => {
    const { toolbar, mode } = setup();
    mode.set('sketch');
    expect(toolbar.groups.get().map((g) => [g.id, g.items.map((i) => i.id)])).toEqual([
      ['select', ['sketch.select']],
      [
        'draw',
        [
          'sketch.line',
          'sketch.rectangle',
          'sketch.circle',
          'sketch.arc',
          'sketch.spline',
          'sketch.slot',
          'sketch.point',
          SKETCH_ACTION_IDS.construction,
        ],
      ],
      ['modify', ['sketch.trim', 'sketch.fillet']],
      [
        'constrain',
        ['sketch.dimension', ...GEOMETRIC_CONSTRAINT_KINDS.map(sketchConstraintActionId)],
      ],
      ['finish', [SKETCH_ACTION_IDS.cancel, SKETCH_ACTION_IDS.finish]],
    ]);
  });

  it('orders history and view around the groups of the sketcher', () => {
    expect(SKETCH_TOOLBAR.groupOrder).toEqual([
      'history',
      'select',
      'draw',
      'modify',
      'constrain',
      'finish',
      'view',
    ]);
  });

  it('the construction button follows the tools of draw, disabled without a session (M31)', () => {
    const { toolbar, mode } = setup();
    mode.set('sketch');
    const draw = toolbar.groups.get().find((g) => g.id === 'draw');
    expect(draw?.items.at(-1)).toMatchObject({
      id: SKETCH_ACTION_IDS.construction,
      command: { kind: 'action', id: SKETCH_ACTION_IDS.construction },
      enabled: false,
      active: false,
      checked: false,
    });
  });

  it('gives cancel, finish and every constraint kind its icon', () => {
    const { toolbar, mode } = setup();
    mode.set('sketch');
    const icons = new Map(
      toolbar.groups
        .get()
        .flatMap((g) => g.items)
        .map((i) => [i.id, i.icon]),
    );
    expect(icons.get(SKETCH_ACTION_IDS.cancel)).toBe('x');
    expect(icons.get(SKETCH_ACTION_IDS.finish)).toBe('check');
    expect(icons.get(SKETCH_ACTION_IDS.construction)).toBe('line-dashed');
    expect(GEOMETRIC_CONSTRAINT_KINDS.map((k) => icons.get(sketchConstraintActionId(k)))).toEqual(
      GEOMETRIC_CONSTRAINT_KINDS.map((k) => EXPECTED_ICONS[k]),
    );
  });

  it('an action of the constraint group that is no kind gets the default icon', () => {
    const [group] = SKETCH_TOOLBAR.actionGroups;
    expect(group?.icon('sketch.constraint.custom')).toBe('link');
  });

  it('adds nothing in the model mode', () => {
    const { toolbar } = setup();
    expect(toolbar.groups.get().map((g) => [g.id, g.items.map((i) => i.id)])).toEqual([
      ['sketch', ['sketch']],
    ]);
  });
});

const EXPECTED_ICONS: Readonly<Record<string, string>> = {
  coincident: 'point',
  horizontal: 'arrows-horizontal',
  vertical: 'arrows-vertical',
  parallel: 'slashes',
  perpendicular: 'angle',
  equal: 'equal',
  tangent: 'circle-dot',
  midpoint: 'letter-m',
  fix: 'lock',
};
