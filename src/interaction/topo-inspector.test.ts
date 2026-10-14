import { describe, expect, it } from 'vitest';
import type { BodyId, FeatureId } from '@/document';
import { FakeRegenStatus, FakeViewport, aTopoNames } from './testing';
import { createTopoInspector } from './topo-inspector';
import type { KeyMods, PickResult, ViewPointerEvent } from './viewport-port';

// Test ids are trusted.
const BODY = 'b1/body' as BodyId;
const FEATURE = 'b1' as FeatureId;

const NO_MODS: KeyMods = { shift: false, alt: false, mod: false };

const FACE_HIT: PickResult = {
  kind: 'face',
  body: BODY,
  faceIndex: 5,
  point: [0, 0, 10],
  normal: [0, 0, 1],
};
const EDGE_HIT: PickResult = { kind: 'edge', body: BODY, edgeIndex: 3, point: [0, 0, 10] };

function pointer(type: ViewPointerEvent['type'], x = 1, y = 2): ViewPointerEvent {
  return { type, x, y, button: type === 'move' || type === 'leave' ? null : 'left', mods: NO_MODS };
}

function setup() {
  const viewport = new FakeViewport();
  const regen = new FakeRegenStatus();
  regen.publish(new Map(), [
    {
      body: BODY,
      feature: FEATURE,
      names: aTopoNames({ faces: { 'b1/face:top': [5] }, edges: { 'b1/edge:top|front': [3] } }),
    },
  ]);
  let picks = 0;
  let hit: PickResult | null = FACE_HIT;
  viewport.setPick(() => {
    picks += 1;
    return hit;
  });
  const inspector = createTopoInspector({ viewport, regen });
  return {
    viewport,
    regen,
    inspector,
    picks: () => picks,
    setHit: (next: PickResult | null) => {
      hit = next;
    },
  };
}

describe('createTopoInspector', () => {
  it('starts disabled and does not pick while disabled', () => {
    const { viewport, inspector, picks } = setup();

    viewport.emitPointer(pointer('move'));

    expect(inspector.enabled.get()).toBe(false);
    expect(inspector.hovered.get()).toBeNull();
    expect(picks()).toBe(0);
  });

  it('when enabled reports the hovered face with its name, picking with the default filter', () => {
    const { viewport, inspector } = setup();
    inspector.setEnabled(true);

    viewport.emitPointer(pointer('move', 3, 4));

    expect(inspector.enabled.get()).toBe(true);
    expect(viewport.lastFilter).toBeUndefined();
    expect(inspector.hovered.get()).toEqual({
      body: BODY,
      kind: 'face',
      index: 5,
      name: 'b1/face:top',
    });
    expect(Object.isFrozen(inspector.hovered.get())).toBe(true);
  });

  it('reports a hovered edge with its name', () => {
    const { viewport, inspector, setHit } = setup();
    inspector.setEnabled(true);
    setHit(EDGE_HIT);

    viewport.emitPointer(pointer('move'));

    expect(inspector.hovered.get()).toEqual({
      body: BODY,
      kind: 'edge',
      index: 3,
      name: 'b1/edge:top|front',
    });
  });

  it('reports a face without a name with name null', () => {
    const { viewport, inspector, setHit } = setup();
    inspector.setEnabled(true);
    setHit({ ...FACE_HIT, faceIndex: 2 });

    viewport.emitPointer(pointer('move'));

    expect(inspector.hovered.get()).toEqual({ body: BODY, kind: 'face', index: 2, name: null });
  });

  it('reports a face of a body missing from the snapshot with name null', () => {
    const { viewport, inspector, setHit } = setup();
    inspector.setEnabled(true);
    setHit({ ...FACE_HIT, body: 'x/body' as BodyId });

    viewport.emitPointer(pointer('move'));

    expect(inspector.hovered.get()).toMatchObject({ kind: 'face', index: 5, name: null });
  });

  it('a miss gives null', () => {
    const { viewport, inspector, setHit } = setup();
    inspector.setEnabled(true);
    viewport.emitPointer(pointer('move'));
    setHit(null);

    viewport.emitPointer(pointer('move'));

    expect(inspector.hovered.get()).toBeNull();
  });

  it('leave gives null', () => {
    const { viewport, inspector } = setup();
    inspector.setEnabled(true);
    viewport.emitPointer(pointer('move'));

    viewport.emitPointer(pointer('leave'));

    expect(inspector.hovered.get()).toBeNull();
  });

  it('ignores down and up', () => {
    const { viewport, inspector, picks } = setup();
    inspector.setEnabled(true);

    viewport.emitPointer(pointer('down'));
    viewport.emitPointer(pointer('up'));

    expect(picks()).toBe(0);
    expect(inspector.hovered.get()).toBeNull();
  });

  it('a new generation gives null', () => {
    const { viewport, regen, inspector } = setup();
    inspector.setEnabled(true);
    viewport.emitPointer(pointer('move'));

    regen.publish(new Map());

    expect(inspector.hovered.get()).toBeNull();
  });

  it('a new snapshot only when the hover changes', () => {
    const { viewport, inspector } = setup();
    inspector.setEnabled(true);
    viewport.emitPointer(pointer('move'));
    const first = inspector.hovered.get();
    let notified = 0;
    inspector.hovered.subscribe(() => (notified += 1));

    viewport.emitPointer(pointer('move', 5, 6));

    expect(inspector.hovered.get()).toBe(first);
    expect(notified).toBe(0);
  });

  it('disabling clears the hover and stops picking', () => {
    const { viewport, inspector, picks } = setup();
    inspector.setEnabled(true);
    viewport.emitPointer(pointer('move'));

    inspector.setEnabled(false);
    viewport.emitPointer(pointer('move'));

    expect(inspector.enabled.get()).toBe(false);
    expect(inspector.hovered.get()).toBeNull();
    expect(picks()).toBe(1);
  });

  it('dispose unsubscribes from the viewport and the port', () => {
    const { viewport, regen, inspector, picks } = setup();
    inspector.setEnabled(true);
    viewport.emitPointer(pointer('move'));
    inspector.dispose();

    viewport.emitPointer(pointer('move'));
    viewport.emitPointer(pointer('leave'));
    regen.publish(new Map());

    expect(picks()).toBe(1);
    expect(inspector.hovered.get()).toMatchObject({ kind: 'face', index: 5 });
  });
});
