import { describe, expect, it } from 'vitest';
import {
  ariaPressed,
  familyVariants,
  fitGroups,
  menuEntries,
  overflowItems,
} from '@/ui/toolbar-fit';

describe('fitGroups', () => {
  const widths = [100, 100, 100];

  it('all groups fit: all of them, no room kept for the button "…"', () => {
    expect(fitGroups(widths, 400, 50)).toBe(3);
  });

  it('all groups fit exactly: all of them, the button "…" is not needed', () => {
    expect(fitGroups(widths, 300, 50)).toBe(3);
  });

  it('the last group does not fit: the groups before it, with the button "…" after them', () => {
    // 40 + 100 + 100 = 240 ≤ 280, one more group would be 340.
    expect(fitGroups(widths, 280, 40)).toBe(2);
  });

  it('the room for the button "…" pushes out one more group', () => {
    // Two groups alone would fit (200 ≤ 250), with the button they do not (60 + 200 = 260).
    expect(fitGroups(widths, 250, 60)).toBe(1);
  });

  it('not even the first group fits: none, only the button "…"', () => {
    expect(fitGroups([300, 100], 200, 40)).toBe(0);
  });

  it('the first group fits alone but not with the button "…": none', () => {
    expect(fitGroups([180, 100], 200, 40)).toBe(0);
  });

  it('no groups: none', () => {
    expect(fitGroups([], 200, 40)).toBe(0);
  });
});

describe('overflowItems', () => {
  const groups = [
    { id: 'a', items: ['a1', 'a2'] },
    { id: 'b', items: ['b1'] },
    { id: 'c', items: ['c1', 'c2'] },
  ];

  it('all groups fit: no items', () => {
    expect(overflowItems(groups, 3)).toEqual([]);
  });

  it('the items of the groups out of the bar, group after group, in their order', () => {
    expect(overflowItems(groups, 1)).toEqual(['b1', 'c1', 'c2']);
  });

  it('not even the first group fits: all items', () => {
    expect(overflowItems(groups, 0)).toEqual(['a1', 'a2', 'b1', 'c1', 'c2']);
  });

  it('no groups: no items', () => {
    expect(overflowItems([], 0)).toEqual([]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(overflowItems(groups, 1))).toBe(true);
  });
});

describe('menuEntries', () => {
  interface Item {
    readonly id: string;
    readonly variants: readonly Item[];
  }
  const plain = (id: string): Item => ({ id, variants: [] });

  it('puts the variants of a family in place of its item, the other items stay', () => {
    const items: Item[] = [
      plain('line'),
      { id: 'circle3p', variants: [plain('circle'), plain('circle3p')] },
      plain('rectangle'),
    ];
    expect(menuEntries(items).map((i) => i.id)).toEqual([
      'line',
      'circle',
      'circle3p',
      'rectangle',
    ]);
  });

  it('no items: none', () => {
    expect(menuEntries([])).toEqual([]);
  });
});

describe('familyVariants', () => {
  interface Item {
    readonly id: string;
    readonly variants: readonly Item[];
  }
  const plain = (id: string): Item => ({ id, variants: [] });
  const arc = plain('arc');
  const tangentArc = plain('tangent-arc');
  // The family shows the tangent arc (the last used) with both as variants.
  const arcs: Item = { id: 'tangent-arc', variants: [arc, tangentArc] };
  const groups = [
    { id: 'draw', items: [plain('line'), arcs] },
    { id: 'other', items: [plain('point')] },
  ];

  it('the variants of the family, found by the shown tool', () => {
    expect(familyVariants(groups, 'draw', 'tangent-arc')).toEqual([arc, tangentArc]);
  });

  it('the variants of the family, found by another tool of it (the shown one changed)', () => {
    expect(familyVariants(groups, 'draw', 'arc')).toEqual([arc, tangentArc]);
  });

  it('a tool outside any family: none', () => {
    expect(familyVariants(groups, 'draw', 'line')).toEqual([]);
  });

  it('the family in another group than asked: none', () => {
    expect(familyVariants(groups, 'other', 'arc')).toEqual([]);
  });

  it('an unknown group: none', () => {
    expect(familyVariants(groups, 'missing', 'arc')).toEqual([]);
  });
});

describe('ariaPressed', () => {
  it('a toggle says pressed or not, a plain button has no aria-pressed (M31)', () => {
    expect(ariaPressed(true)).toBe('true');
    expect(ariaPressed(false)).toBe('false');
    expect(ariaPressed(null)).toBeUndefined();
  });
});
