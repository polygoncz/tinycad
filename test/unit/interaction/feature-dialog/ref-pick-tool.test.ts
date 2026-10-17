import { createSequentialIdGenerator } from '@/core';
import {
  ORIGIN_PLANE_IDS,
  createFeatureSchemaRegistry,
  sketchId,
  validateAgainstSchema,
} from '@/document';
import { aFeature, ORIGIN_AXIS_IDS } from '@/document/testing';
import type { BodyId, FeatureId, FeatureSchema, ParamSchema, TopoName } from '@/document';
import { anOpsSession } from '@/ops/testing';
import { rectangleData } from '@/sketch/testing';
import { describe, expect, it } from 'vitest';
import { createFeatureEditor } from '@/interaction/feature-dialog/feature-editor';
import { createRefPick, createRefPickLayer } from '@/interaction/feature-dialog/ref-pick-tool';
import { toggleBodyRef } from '@/interaction/feature-dialog/ref-values';
import { FakeRegenStatus, FakeViewport, aTopoNames } from '@/interaction/testing';
import type { PickResult, ViewKeyEvent, ViewPointerEvent } from '@/interaction/viewport-port';

/**
 * A drawing that is not the artifact of any sketch feature (parseSketchId does not take its id),
 * such as the drawing of the sketch being edited: it cannot be referenced.
 */
const NON_ARTIFACT_DRAWING = 'non-artifact-drawing';

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

  it('a region of a drawing that is not an artifact does nothing', () => {
    const { session, viewport, click } = setupProfile();
    const before = session.state.get();
    viewport.setPick(regionHit(NON_ARTIFACT_DRAWING, 'ab,bc,cd,da'));
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

  it('a circle of a sketch, a non-artifact drawing and a plane drawing do nothing and are not hovered', () => {
    const { session, viewport, click, move } = focusedOnAxis();
    const before = session.state.get();
    for (const hit of [
      entityHit(S1_DRAWING, 'k'),
      entityHit(NON_ARTIFACT_DRAWING, 'ab'),
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

describe('refPick into a planes param (M21)', () => {
  function focusedOnPlane() {
    const setup = setupProfile();
    setup.session.focusRefParam('plane');
    return setup;
  }

  it('a click on an origin plane drawing sets the plane, a second plane replaces it', () => {
    const { session, viewport, click } = focusedOnPlane();
    viewport.setPick(entityHit(ORIGIN_PLANE_IDS.xz, 'l1'));
    click();
    expect(viewport.lastFilter).toEqual(['face', 'sketchEntity']);
    expect(session.state.get().params['plane']).toEqual([
      { kind: 'plane', plane: ORIGIN_PLANE_IDS.xz },
    ]);
    // The pick ended the focus; the field focuses the param again.
    session.focusRefParam('plane');
    viewport.setPick(entityHit(ORIGIN_PLANE_IDS.yz, 'l2'));
    click();
    expect(session.state.get().params['plane']).toEqual([
      { kind: 'plane', plane: ORIGIN_PLANE_IDS.yz },
    ]);
  });

  it('a picked plane ends the focus, also the plane already in the value (spec 11)', () => {
    const { session, viewport, click } = focusedOnPlane();
    viewport.setPick(entityHit(ORIGIN_PLANE_IDS.xz, 'l1'));
    click();
    expect(session.state.get().activeRefParam).toBeNull();
    const value = session.state.get().params['plane'];
    session.focusRefParam('plane');
    click();
    expect(session.state.get().params['plane']).toBe(value);
    expect(session.state.get().activeRefParam).toBeNull();
  });

  it('a hit that is no plane keeps the focus', () => {
    const { session, viewport, click } = focusedOnPlane();
    viewport.setPick(entityHit(S1_DRAWING, 'ab'));
    click();
    expect(session.state.get().activeRefParam).toBe('plane');
  });

  it('hovers a plane drawing, not a line of a sketch, which a click does not take either', () => {
    const { session, viewport, click, move } = focusedOnPlane();
    viewport.setPick(entityHit(ORIGIN_PLANE_IDS.xy, 'l1'));
    move();
    expect(viewport.hover).toEqual(entityHit(ORIGIN_PLANE_IDS.xy, 'l1'));
    viewport.setPick(entityHit(S1_DRAWING, 'ab'));
    move();
    expect(viewport.hover).toBeNull();
    click();
    expect(session.state.get().params['plane']).toEqual([]);
  });
});

// --- refPick into topo params (M14) ---

const FILLET_PARAMS: ParamSchema = {
  edges: { kind: 'topo', label: 'Edges', entity: 'edge' },
  faces: { kind: 'topo', label: 'Faces', entity: 'face' },
};

const FILLET: FeatureSchema = {
  type: 'filletish',
  version: 1,
  label: 'Filletish',
  params: FILLET_PARAMS,
  defaults: () => ({ edges: [], faces: [] }),
  validate: (params) => validateAgainstSchema(FILLET_PARAMS, params),
};

const BOX = 'b1/body' as BodyId; // test ids are trusted
const UNNAMED_BODY = 'b2/body' as BodyId;
const TOP_FRONT = 'b1/edge:face:front|face:top' as TopoName;
const TOP = 'b1/face:top' as TopoName;

/**
 * A snapshot with BOX named (edge 3, face 5) and UNNAMED_BODY without names, published as the
 * input of the session's feature (M21: past the in-between state); publishInputOfSession
 * publishes another such snapshot.
 */
function setupFillet(options: { readonly withRegen?: boolean } = {}) {
  const regen = new FakeRegenStatus();
  const schemas = createFeatureSchemaRegistry();
  schemas.register(FILLET);
  const ops = anOpsSession({ schemas });
  const editor = createFeatureEditor({
    doc: ops.doc,
    ops: ops.dispatcher,
    schemas,
    ids: createSequentialIdGenerator('new'),
  });
  const session = editor.create('filletish');
  const publishInputOfSession = (bodies: Parameters<FakeRegenStatus['publish']>[1]): void => {
    regen.publish(new Map(), bodies, [], new Map(), {
      feature: session.featureId,
      bodies: bodies ?? [],
    });
  };
  publishInputOfSession([
    {
      body: BOX,
      feature: 'b1' as FeatureId,
      names: aTopoNames({ edges: { [TOP_FRONT]: [3] }, faces: { [TOP]: [5] } }),
    },
    { body: UNNAMED_BODY, feature: 'b2' as FeatureId },
  ]);
  const viewport = new FakeViewport();
  const refPick = createRefPick(
    session,
    viewport,
    ops.doc,
    options.withRegen === false ? undefined : regen,
  );
  const pointer = (type: ViewPointerEvent['type']): ViewPointerEvent => ({
    type,
    x: 1,
    y: 1,
    button: 'left',
    mods: { shift: false, alt: false, mod: false },
  });
  return {
    session,
    viewport,
    regen,
    publishInputOfSession,
    click: (): void => {
      refPick.onPointer(pointer('down'));
      refPick.onPointer(pointer('up'));
    },
    move: (): void => {
      refPick.onPointer(pointer('move'));
    },
  };
}

const edgeAt = (body: BodyId, edgeIndex: number): PickResult => ({
  kind: 'edge',
  body,
  edgeIndex,
  point: [0, 0, 0],
});

const faceAt = (body: BodyId, faceIndex: number): PickResult => ({
  kind: 'face',
  body,
  faceIndex,
  point: [0, 0, 0],
  normal: [0, 0, 1],
});

describe('refPick – topo param (M14)', () => {
  it('a click on a named edge adds a TopoRef, a second click removes it', () => {
    const { session, viewport, click } = setupFillet();
    expect(session.state.get().activeRefParam).toBe('edges');
    viewport.setPick(edgeAt(BOX, 3));

    click();
    expect(viewport.lastFilter).toEqual(['edge']);
    const value = session.state.get().params['edges'];
    expect(value).toEqual([{ kind: 'topo', body: BOX, name: TOP_FRONT }]);
    expect(Object.isFrozen(value)).toBe(true);

    click();
    expect(session.state.get().params['edges']).toEqual([]);
  });

  it('a face param picks faces only and takes a named face', () => {
    const { session, viewport, click } = setupFillet();
    session.focusRefParam('faces');
    viewport.setPick(faceAt(BOX, 5));

    click();
    expect(viewport.lastFilter).toEqual(['face']);
    expect(session.state.get().params['faces']).toEqual([{ kind: 'topo', body: BOX, name: TOP }]);
  });

  it('an edge without a name, or of a body without names or not in the snapshot, does nothing', () => {
    const { session, viewport, click } = setupFillet();
    const before = session.state.get();
    for (const hit of [edgeAt(BOX, 4), edgeAt(UNNAMED_BODY, 3), edgeAt('b9/body' as BodyId, 3)]) {
      viewport.setPick(hit);
      click();
    }
    expect(session.state.get()).toBe(before);
  });

  it('hovers only hits with a name', () => {
    const { viewport, move } = setupFillet();
    viewport.setPick(edgeAt(BOX, 3));
    move();
    expect(viewport.hover).toEqual(edgeAt(BOX, 3));

    viewport.setPick(edgeAt(BOX, 4));
    move();
    expect(viewport.hover).toBeNull();
  });

  it('uses the last snapshot: a new generation with other indices names another edge', () => {
    const { session, viewport, publishInputOfSession, click } = setupFillet();
    publishInputOfSession([
      { body: BOX, feature: 'b1' as FeatureId, names: aTopoNames({ edges: { [TOP_FRONT]: [7] } }) },
    ]);
    viewport.setPick(edgeAt(BOX, 3));
    click();
    expect(session.state.get().params['edges']).toEqual([]);

    viewport.setPick(edgeAt(BOX, 7));
    click();
    expect(session.state.get().params['edges']).toEqual([
      { kind: 'topo', body: BOX, name: TOP_FRONT },
    ]);
  });

  it('without regen a hit adds nothing and is not hovered', () => {
    const { session, viewport, click, move } = setupFillet({ withRegen: false });
    const before = session.state.get();
    viewport.setPick(edgeAt(BOX, 3));
    viewport.highlight.setHover(edgeAt(BOX, 3));

    move();
    click();

    expect(viewport.hover).toBeNull();
    expect(session.state.get()).toBe(before);
  });
});

// --- refPick against the pickable bodies (M21, ADR 0025) ---

describe('refPick – the input of the edited feature (M21)', () => {
  const ROUND_EDGE = 'b1/edge:face:round|face:top' as TopoName;

  /**
   * Publishes the final state naming edge 3 ROUND_EDGE and edge 8 likewise, and the input of
   * `feature` naming edge 3 TOP_FRONT.
   */
  function publishInput(regen: FakeRegenStatus, feature: FeatureId | null): void {
    regen.publish(
      new Map(),
      [
        {
          body: BOX,
          feature: 'b1' as FeatureId,
          names: aTopoNames({ edges: { [ROUND_EDGE]: [3, 8] } }),
        },
      ],
      [],
      new Map(),
      {
        feature,
        bodies: [
          {
            body: BOX,
            feature: 'b1' as FeatureId,
            names: aTopoNames({ edges: { [TOP_FRONT]: [3] } }),
          },
        ],
      },
    );
  }

  it('a hit on an edge named only in the input takes the name of the input', () => {
    const { session, viewport, regen, click } = setupFillet();
    publishInput(regen, session.featureId);
    viewport.setPick(edgeAt(BOX, 3));

    click();

    expect(session.state.get().params['edges']).toEqual([
      { kind: 'topo', body: BOX, name: TOP_FRONT },
    ]);
  });

  it('a name only in the final state is not taken and not hovered', () => {
    const { session, viewport, regen, click, move } = setupFillet();
    publishInput(regen, session.featureId);
    const before = session.state.get();
    viewport.setPick(edgeAt(BOX, 8));

    move();
    click();

    expect(viewport.hover).toBeNull();
    expect(session.state.get()).toBe(before);
  });

  it('ignores hits while the pickable bodies are the input of another feature', () => {
    const { session, viewport, regen, click, move } = setupFillet();
    publishInput(regen, 'other' as FeatureId);
    const before = session.state.get();
    let picks = 0;
    viewport.setPick(() => {
      picks += 1;
      return edgeAt(BOX, 3);
    });
    viewport.highlight.setHover(edgeAt(BOX, 3));

    move();
    click();

    expect(picks).toBe(0);
    expect(viewport.hover).toBeNull();
    expect(session.state.get()).toBe(before);

    // The regeneration with the input of the session's own feature ends the in-between state.
    publishInput(regen, session.featureId);
    move();
    expect(viewport.hover).toEqual(edgeAt(BOX, 3));
  });

  it('ignores hits while the pickable bodies are the final state (pick.feature null)', () => {
    const { session, viewport, regen, click, move } = setupFillet();
    publishInput(regen, null);
    viewport.setPick(edgeAt(BOX, 3));

    move();
    click();

    expect(viewport.hover).toBeNull();
    expect(session.state.get().params['edges']).toEqual([]);
  });
});

// --- the refPick layer of ToolManager (M20, A4.3): knows by itself when it covers the tool ---

function setupLayer() {
  const schemas = createFeatureSchemaRegistry();
  schemas.register(PROFILE);
  const ops = anOpsSession({ schemas });
  const features = createFeatureEditor({
    doc: ops.doc,
    ops: ops.dispatcher,
    schemas,
    ids: createSequentialIdGenerator('new'),
  });
  const viewport = new FakeViewport();
  const unhandled: string[] = [];
  const layer = createRefPickLayer({
    features,
    viewport,
    doc: ops.doc,
    unhandledKey: (e) => {
      unhandled.push(e.key);
      return false;
    },
  });
  const pointer = (type: ViewPointerEvent['type']): ViewPointerEvent => ({
    type,
    x: 1,
    y: 1,
    button: 'left',
    mods: { shift: false, alt: false, mod: false },
  });
  const key = (k: string): ViewKeyEvent => ({
    key: k,
    mods: { shift: false, alt: false, mod: false },
    inTextField: false,
  });
  return { features, viewport, layer, unhandled, pointer, key };
}

describe('createRefPickLayer', () => {
  it('handles nothing without a session or without a focused param', () => {
    const { features, layer, unhandled, pointer, key } = setupLayer();
    expect(layer.onPointer(pointer('move'))).toBe(false);
    expect(layer.onKey(key('Escape'))).toBe(false);

    features.create('profile').focusRefParam(null);
    expect(layer.onPointer(pointer('down'))).toBe(false);
    expect(layer.onKey(key('a'))).toBe(false);
    expect(unhandled).toEqual([]);
  });

  it('with a focused param takes every event; a key refPick does not handle goes to unhandledKey', () => {
    const { features, layer, unhandled, pointer, key } = setupLayer();
    const session = features.create('profile');
    session.focusRefParam('regions');

    for (const type of ['move', 'down', 'up', 'leave'] as const) {
      expect(layer.onPointer(pointer(type))).toBe(true);
    }
    expect(layer.onKey(key('a'))).toBe(true);
    expect(unhandled).toEqual(['a']);
    expect(layer.onKey(key('Escape'))).toBe(true);
    expect(unhandled).toEqual(['a']);
    expect(session.state.get().activeRefParam).toBeNull();
    expect(layer.onPointer(pointer('move'))).toBe(false);
  });

  it('shows the shared hover itself: no synthetic leave below it', () => {
    expect(setupLayer().layer.leaveBelow).toBe(false);
  });

  it('dispose clears the hover, stops following the editor and is idempotent', () => {
    const { features, viewport, layer, pointer } = setupLayer();
    const session = features.create('profile');
    session.focusRefParam('regions');
    viewport.highlight.setHover(regionHit(S1_DRAWING, 'r1'));

    layer.dispose();
    layer.dispose();
    expect(viewport.hover).toBeNull();
    session.focusRefParam('axis');
    expect(layer.onPointer(pointer('move'))).toBe(false);
  });
});
