import { describe, expect, it } from 'vitest';
import type { BodyId, FeatureId } from '@/document';
import { createBrowserModel } from './browser-model';
import type { RegenBody } from './regen-status-port';
import { createSelectionModel } from './selection';
import { FakeRegenStatus } from './testing';

const fid = (id: string): FeatureId => id as FeatureId; // test ids are trusted
const bid = (id: string): BodyId => id as BodyId; // test ids are trusted

const B1 = bid('f1/body');
const B2 = bid('f2/body');
const B3 = bid('f3/body');
const BODIES: readonly RegenBody[] = [
  { body: B1, feature: fid('f1') },
  { body: B2, feature: fid('f2') },
];

function setup() {
  const regen = new FakeRegenStatus();
  const selection = createSelectionModel({ regen });
  const browser = createBrowserModel({ regen, selection });
  let bodyEmits = 0;
  let hiddenEmits = 0;
  browser.bodies.subscribe(() => bodyEmits++);
  browser.hidden.subscribe(() => hiddenEmits++);
  return {
    regen,
    selection,
    browser,
    bodyEmits: () => bodyEmits,
    hiddenEmits: () => hiddenEmits,
  };
}

describe('BrowserModel rows', () => {
  it('starts empty with nothing hidden', () => {
    const s = setup();
    expect(s.browser.bodies.get()).toEqual([]);
    expect(s.browser.hidden.get().size).toBe(0);
  });

  it('lists the bodies of the last regeneration in their order, numbered from 1', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    expect(s.browser.bodies.get()).toEqual([
      {
        body: B1,
        name: { key: 'browser.body', n: 1 },
        feature: 'f1',
        visible: true,
        selected: false,
      },
      {
        body: B2,
        name: { key: 'browser.body', n: 2 },
        feature: 'f2',
        visible: true,
        selected: false,
      },
    ]);
  });

  it('freezes the snapshot and its rows', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    const rows = s.browser.bodies.get();
    expect(Object.isFrozen(rows)).toBe(true);
    expect(rows.every((r) => Object.isFrozen(r) && Object.isFrozen(r.name))).toBe(true);
  });

  it('keeps an unchanged row as the same object and the same snapshot without emitting', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    const before = s.browser.bodies.get();
    const emits = s.bodyEmits();

    s.regen.publish(new Map(), BODIES);
    expect(s.browser.bodies.get()).toBe(before);
    expect(s.bodyEmits()).toBe(emits);

    s.regen.publish(new Map(), [...BODIES, { body: B3, feature: fid('f3') }]);
    const after = s.browser.bodies.get();
    expect(after).not.toBe(before);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]?.body).toBe(B3);
  });

  it('marks rows selected from body items of the selection', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    const before = s.browser.bodies.get();
    s.selection.set([
      { kind: 'body', body: B2 },
      { kind: 'face', body: B1, faceIndex: 0 },
      { kind: 'feature', feature: fid('f1') },
    ]);
    const rows = s.browser.bodies.get();
    expect(rows.map((r) => r.selected)).toEqual([false, true]);
    expect(rows[0]).toBe(before[0]);
  });
});

describe('BrowserModel.select', () => {
  it('replaces the selection with the body', () => {
    const s = setup();
    s.selection.set([{ kind: 'feature', feature: fid('f1') }]);
    s.browser.select(B1);
    expect(s.selection.items.get()).toEqual([{ kind: 'body', body: B1 }]);
  });

  it('with additive toggles the body in the selection', () => {
    const s = setup();
    s.browser.select(B1);
    s.browser.select(B2, { additive: true });
    expect(s.selection.items.get()).toEqual([
      { kind: 'body', body: B1 },
      { kind: 'body', body: B2 },
    ]);
    s.browser.select(B1, { additive: true });
    expect(s.selection.items.get()).toEqual([{ kind: 'body', body: B2 }]);
  });
});

describe('BrowserModel.setVisible', () => {
  it('hides a body: hidden contains it and its row is not visible', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    const before = s.browser.bodies.get();
    s.browser.setVisible(B2, false);
    expect([...s.browser.hidden.get()]).toEqual([B2]);
    const rows = s.browser.bodies.get();
    expect(rows.map((r) => r.visible)).toEqual([true, false]);
    expect(rows[0]).toBe(before[0]);
  });

  it('shows a hidden body again', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.setVisible(B2, false);
    s.browser.setVisible(B2, true);
    expect(s.browser.hidden.get().size).toBe(0);
    expect(s.browser.bodies.get().map((r) => r.visible)).toEqual([true, true]);
  });

  it('the same value emits nothing', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.setVisible(B1, true);
    expect(s.hiddenEmits()).toBe(0);

    s.browser.setVisible(B1, false);
    const hidden = s.browser.hidden.get();
    const rows = s.browser.bodies.get();
    const [h, b] = [s.hiddenEmits(), s.bodyEmits()];
    s.browser.setVisible(B1, false);
    expect(s.browser.hidden.get()).toBe(hidden);
    expect(s.browser.bodies.get()).toBe(rows);
    expect(s.hiddenEmits()).toBe(h);
    expect(s.bodyEmits()).toBe(b);
  });

  it('a body unknown to the last regeneration does nothing', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.setVisible(B3, false);
    expect(s.browser.hidden.get().size).toBe(0);
    expect(s.hiddenEmits()).toBe(0);
  });

  it('a new hidden set is published on each change; the old one does not change', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.setVisible(B1, false);
    const first = s.browser.hidden.get();
    s.browser.setVisible(B2, false);
    expect([...first]).toEqual([B1]);
    expect(new Set(s.browser.hidden.get())).toEqual(new Set([B1, B2]));
  });

  it('a body missing from the next regeneration drops out of hidden', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.setVisible(B1, false);
    s.browser.setVisible(B2, false);

    s.regen.publish(new Map(), [{ body: B2, feature: fid('f2') }]);
    expect([...s.browser.hidden.get()]).toEqual([B2]);
    expect(s.browser.bodies.get()).toEqual([
      {
        body: B2,
        name: { key: 'browser.body', n: 1 },
        feature: 'f2',
        visible: false,
        selected: false,
      },
    ]);
  });

  it('a regeneration with all hidden bodies still present keeps the hidden set', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.setVisible(B1, false);
    const hidden = s.browser.hidden.get();
    const emits = s.hiddenEmits();
    s.regen.publish(new Map(), BODIES);
    expect(s.browser.hidden.get()).toBe(hidden);
    expect(s.hiddenEmits()).toBe(emits);
  });
});

describe('BrowserModel.dispose', () => {
  it('unsubscribes from the regeneration status and the selection', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.dispose();
    const rows = s.browser.bodies.get();
    s.regen.publish(new Map(), []);
    s.selection.set([{ kind: 'body', body: B1 }]);
    expect(s.browser.bodies.get()).toBe(rows);
  });
});
