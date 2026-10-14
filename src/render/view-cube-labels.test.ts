import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@/core';
import { STANDARD_VIEWS, type StandardView } from './camera-math';
import {
  DEFAULT_VIEW_CUBE_LABELS,
  faceLabelKey,
  sameLabels,
  VIEW_CUBE_ARROWS,
  type ViewCubeLabelKey,
} from './view-cube-labels';

const KEYS: readonly ViewCubeLabelKey[] = [
  'front',
  'back',
  'left',
  'right',
  'top',
  'bottom',
  'turnLeft',
  'turnRight',
  'turnUp',
  'turnDown',
  'rollClockwise',
  'rollCounterClockwise',
  'switchToFree',
  'switchToTurntable',
];

describe('DEFAULT_VIEW_CUBE_LABELS', () => {
  it('has the English texts of spec 11 for all 14 keys', () => {
    expect(DEFAULT_VIEW_CUBE_LABELS).toEqual({
      front: 'Front',
      back: 'Back',
      left: 'Left',
      right: 'Right',
      top: 'Top',
      bottom: 'Bottom',
      turnLeft: 'Turn left',
      turnRight: 'Turn right',
      turnUp: 'Turn up',
      turnDown: 'Turn down',
      rollClockwise: 'Roll clockwise',
      rollCounterClockwise: 'Roll counterclockwise',
      switchToFree: 'Switch to free rotation',
      switchToTurntable: 'Switch to rotation with Z up',
    });
    expect(Object.keys(DEFAULT_VIEW_CUBE_LABELS).sort()).toEqual([...KEYS].sort());
  });

  it('is frozen', () => {
    expect(Object.isFrozen(DEFAULT_VIEW_CUBE_LABELS)).toBe(true);
  });
});

describe('sameLabels', () => {
  it('is true for equal values in another object', () => {
    expect(sameLabels(DEFAULT_VIEW_CUBE_LABELS, { ...DEFAULT_VIEW_CUBE_LABELS })).toBe(true);
  });

  it.each(KEYS)('is false when %s differs', (key) => {
    expect(sameLabels(DEFAULT_VIEW_CUBE_LABELS, { ...DEFAULT_VIEW_CUBE_LABELS, [key]: 'x' })).toBe(
      false,
    );
  });
});

describe('VIEW_CUBE_ARROWS', () => {
  it('turns like spec 09 "Operace" (turn): the model follows the arrow', () => {
    const turns = Object.fromEntries(
      VIEW_CUBE_ARROWS.map((a) => [a.key, [a.axis, a.quarterTurns]] as const),
    );
    expect(turns).toEqual({
      turnRight: ['up', 1],
      turnLeft: ['up', -1],
      turnDown: ['right', 1],
      turnUp: ['right', -1],
      rollClockwise: ['view', -1],
      rollCounterClockwise: ['view', 1],
    });
  });
});

describe('faceLabelKey', () => {
  it.each<Exclude<StandardView, 'iso'>>(['front', 'back', 'left', 'right', 'top', 'bottom'])(
    'the face looked at from the %s view carries its label',
    (view) => {
      expect(faceLabelKey(STANDARD_VIEWS[view].direction)).toBe(view);
    },
  );

  it.each<[Vec3]>([[[1, -1, 0]], [[1, -1, 1]]])('edges and corners have no label: %j', (region) => {
    expect(faceLabelKey(region)).toBeNull();
  });
});
