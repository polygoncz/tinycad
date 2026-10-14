import { createSequentialIdGenerator } from '@/core';
import {
  ORIGIN_AXIS_IDS,
  createFeatureSchemaRegistry,
  sketchId,
  validateAgainstSchema,
} from '@/document';
import type { BodyId, FeatureId, FeatureSchema, ParamSchema, ParamSpec } from '@/document';
import { aFeature } from '@/document/testing';
import { anOpsSession } from '@/ops/testing';
import { rectangleData } from '@/sketch/testing';
import { describe, expect, it } from 'vitest';
import { createFeatureEditor } from './feature-editor';
import { createRefPick, pickFilterFor } from './ref-pick-tool';
import { toggleBodyRef } from './ref-values';
import { EDIT_SKETCH_DRAWING_ID } from './sketch-session';
import { FakeViewport } from './testing';
import type { PickResult, ViewPointerEvent } from './viewport-port';

describe('pickFilterFor', () => {
  it('bodies: a hit on anything is the body, so faces and edges', () => {
    const spec: ParamSpec = { kind: 'bodies', label: 'Targets' };
    expect([...pickFilterFor(spec)].sort()).toEqual(['edge', 'face']);
  });

  it.each([
    ['face', ['face']],
    ['edge', ['edge']],
    // Vertices are not pickable until M14.
    ['vertex', []],
  ] as const)('topo with entity %s → %j', (entity, filter) => {
    const spec: ParamSpec = { kind: 'topo', label: 'Entities', entity };
    expect(pickFilterFor(spec)).toEqual(filter);
  });

  it('region: sketch regions (M13)', () => {
    expect(pickFilterFor({ kind: 'region', label: 'Profile' })).toEqual(['sketchRegion']);
  });

  it('axis: sketch entities, an axis drawing or a line of a sketch (M13)', () => {
    expect(pickFilterFor({ kind: 'axis', label: 'Axis' })).toEqual(['sketchEntity']);
  });

  it('planes: nothing, planes are picked in the Browser (M12)', () => {
    expect(pickFilterFor({ kind: 'planes', label: 'Plane' })).toEqual([]);
  });

  it.each<ParamSpec>([
    { kind: 'length', label: 'Width', default: 10 },
    { kind: 'angle', label: 'Angle', default: 0 },
    { kind: 'number', label: 'Count', default: 1 },
    { kind: 'boolean', label: 'Flip', default: false },
    { kind: 'enum', label: 'Mode', default: 'a', options: [{ value: 'a', label: 'A' }] },
    { kind: 'point', label: 'Origin', default: [0, 0, 0] },
    { kind: 'data', label: 'Sketch' },
  ])('a value param ($kind) picks nothing', (spec) => {
    expect(pickFilterFor(spec)).toEqual([]);
  });
});

describe('toggleBodyRef', () => {
  const body = (id: string): BodyId => id as BodyId; // test ids are trusted
  const ref = (id: string) => ({ kind: 'body', body: body(id) });

  it('adds the body at the end as a frozen reference', () => {
    const next = toggleBodyRef([ref('a/body')], body('b/body'));
    expect(next).toEqual([ref('a/body'), ref('b/body')]);
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next[1])).toBe(true);
  });

  it('removes a body that is there and keeps the order of the rest', () => {
    const other = { kind: 'topo', body: body('b/body'), name: 'x' };
    const value = [ref('a/body'), other, ref('b/body'), ref('c/body')];
    expect(toggleBodyRef(value, body('b/body'))).toEqual([ref('a/body'), other, ref('c/body')]);
  });

  it('a value that is not an array counts as empty', () => {
    expect(toggleBodyRef(undefined, body('a/body'))).toEqual([ref('a/body')]);
    expect(toggleBodyRef('junk', body('a/body'))).toEqual([ref('a/body')]);
  });
});

// --- refPick into region and axis params (M13) ---

const PROFILE_PARAMS: ParamSchema = {
  regions: { kind: 'region', label: 'Regions' },
  axis: { kind: 'axis', label: 'Axis' },
  plane: { kind: 'planes', label: 'Plane' },
};

const PROFILE: FeatureSchema = {
  type: 'profile',
  version: 1,
  label: 'Profile',
  params: PROFILE_PARAMS,
  defaults: () => ({ regions: [], axis: null, plane: [] }),
  validate: (params) => validateAgainstSchema(PROFILE_PARAMS, params),
};

const S1 = 's1' as FeatureId; // test ids are trusted
const S1_DRAWING: string = sketchId(S1);

function setupProfile() {
  const rect = rectangleData();
  const sketch = aFeature({
    id: 's1',
    type: 'sketch',
    name: 'Sketch 1',
    params: {
      entities: [
        ...rect.entities,
        { kind: 'point', id: 'o', x: 5, y: 2 },
        { kind: 'circle', id: 'k', center: 'o', radius: 1 },
      ],
      constraints: rect.constraints,
    },
  });
  const schemas = createFeatureSchemaRegistry();
  schemas.register(PROFILE);
  const ops = anOpsSession({ features: [sketch], schemas });
  const editor = createFeatureEditor({
    doc: ops.doc,
    ops: ops.dispatcher,
    schemas,
    ids: createSequentialIdGenerator('new'),
  });
  const session = editor.create('profile');
  const viewport = new FakeViewport();
  const refPick = createRefPick(session, viewport, ops.doc);
  const pointer = (type: ViewPointerEvent['type']): ViewPointerEvent => ({
    type,
    x: 1,
    y: 1,
    button: 'left',
    mods: { shift: false, alt: false, mod: false },
  });
  const click = (): void => {
    refPick.onPointer(pointer('down'));
    refPick.onPointer(pointer('up'));
  };
  const move = (): void => {
    refPick.onPointer(pointer('move'));
  };
  return { session, viewport, click, move };
}

const regionHit = (sketch: string, region: string): PickResult => ({
  kind: 'sketchRegion',
  sketch,
  region,
  point: [0, 0, 0],
});

const entityHit = (sketch: string, entity: string): PickResult => ({
  kind: 'sketchEntity',
  sketch,
  entity,
  point: [0, 0, 0],
});

describe('refPick – region param (M13)', () => {
  it('a click on a region adds a SketchRegionRef, a second click removes it', () => {
    const { session, viewport, click } = setupProfile();
    expect(session.state.get().activeRefParam).toBe('regions');
    viewport.setPick(regionHit(S1_DRAWING, 'ab,bc,cd,da,k'));

    click();
    expect(session.state.get().params['regions']).toEqual([
      { kind: 'region', sketch: 's1', region: 'ab,bc,cd,da,k' },
    ]);
    expect(viewport.lastFilter).toEqual(['sketchRegion']);

    click();
    expect(session.state.get().params['regions']).toEqual([]);
  });

  it('a region of the edited sketch drawing does nothing', () => {
    const { session, viewport, click } = setupProfile();
    const before = session.state.get();
    viewport.setPick(regionHit(EDIT_SKETCH_DRAWING_ID, 'ab,bc,cd,da'));
    click();
    expect(session.state.get()).toBe(before);
  });
});

describe('refPick – axis param (M13)', () => {
  function focusedOnAxis() {
    const s = setupProfile();
    s.session.focusRefParam('axis');
    return s;
  }

  it('a click on an origin axis sets an AxisRef, a second click clears it', () => {
    const { session, viewport, click } = focusedOnAxis();
    viewport.setPick(entityHit(ORIGIN_AXIS_IDS.z, 'axis'));

    click();
    expect(session.state.get().params['axis']).toEqual({ kind: 'axis', axis: ORIGIN_AXIS_IDS.z });
    expect(viewport.lastFilter).toEqual(['sketchEntity']);

    click();
    expect(session.state.get().params['axis']).toBeNull();
  });

  it('a click on a line of a sketch sets a SketchEntityRef', () => {
    const { session, viewport, click } = focusedOnAxis();
    viewport.setPick(entityHit(S1_DRAWING, 'ab'));
    click();
    expect(session.state.get().params['axis']).toEqual({
      kind: 'sketchEntity',
      sketch: 's1',
      entity: 'ab',
    });
  });

  it('another axis replaces the value', () => {
    const { session, viewport, click } = focusedOnAxis();
    viewport.setPick(entityHit(S1_DRAWING, 'ab'));
    click();
    viewport.setPick(entityHit(ORIGIN_AXIS_IDS.x, 'axis'));
    click();
    expect(session.state.get().params['axis']).toEqual({ kind: 'axis', axis: ORIGIN_AXIS_IDS.x });
  });

  it('a circle of a sketch, the edited sketch and a plane drawing do nothing and are not hovered', () => {
    const { session, viewport, click, move } = focusedOnAxis();
    const before = session.state.get();
    for (const hit of [
      entityHit(S1_DRAWING, 'k'),
      entityHit(EDIT_SKETCH_DRAWING_ID, 'ab'),
      entityHit('origin/plane:xy', 'edge0'),
    ]) {
      viewport.setPick(hit);
      viewport.highlight.setHover(hit);
      move();
      expect(viewport.hover).toBeNull();
      click();
    }
    expect(session.state.get()).toBe(before);
  });

  it('hovers an origin axis and a line of a sketch', () => {
    const { viewport, move } = focusedOnAxis();
    viewport.setPick(entityHit(ORIGIN_AXIS_IDS.x, 'axis'));
    move();
    expect(viewport.hover).toEqual(entityHit(ORIGIN_AXIS_IDS.x, 'axis'));
    viewport.setPick(entityHit(S1_DRAWING, 'bc'));
    move();
    expect(viewport.hover).toEqual(entityHit(S1_DRAWING, 'bc'));
  });
});

describe('refPick – a param without a pick filter', () => {
  it('a planes param does not ask the viewport and hovers nothing', () => {
    const { session, viewport, click, move } = setupProfile();
    session.focusRefParam('plane');
    const before = session.state.get();
    let picks = 0;
    viewport.setPick(() => {
      picks++;
      return regionHit(S1_DRAWING, 'k');
    });
    viewport.highlight.setHover(regionHit(S1_DRAWING, 'k'));

    move();
    click();

    expect(picks).toBe(0);
    expect(viewport.hover).toBeNull();
    expect(session.state.get()).toBe(before);
  });
});
