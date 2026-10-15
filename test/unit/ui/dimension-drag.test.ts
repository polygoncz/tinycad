import { describe, expect, it } from 'vitest';
import type { SketchDimensionView } from '@/sketcher';
import { createDimensionDrag } from '@/ui/dimension-drag';

// Test ids are trusted.
const cid = (id: string): SketchDimensionView['id'] => id as SketchDimensionView['id'];

/** A fake of the two calls of SketchSession the drag makes, recording them in order. */
function aSketch() {
  const calls: string[] = [];
  return {
    calls,
    moveDimension(id: SketchDimensionView['id'], x: number, y: number): void {
      calls.push(`move ${id} ${String(x)} ${String(y)}`);
    },
    endMoveDimension(): void {
      calls.push('end');
    },
  };
}

describe('createDimensionDrag (drag of a dimension label vs. click)', () => {
  it('a click without moving moves nothing and the click selects', () => {
    const sketch = aSketch();
    const drag = createDimensionDrag(sketch);
    drag.down(cid('d1'), 10, 10);
    drag.move(12, 11);
    drag.up();
    expect(sketch.calls).toEqual([]);
    expect(drag.takeClick()).toBe(true);
  });

  it('a move beyond the click tolerance drags: every move from then on is moveDimension', () => {
    const sketch = aSketch();
    const drag = createDimensionDrag(sketch);
    drag.down(cid('d1'), 10, 10);
    drag.move(20, 10);
    drag.move(12, 11);
    drag.up();
    expect(sketch.calls).toEqual(['move d1 20 10', 'move d1 12 11', 'end']);
  });

  it('the click after a drag does not select, the next one does', () => {
    const sketch = aSketch();
    const drag = createDimensionDrag(sketch);
    drag.down(cid('d1'), 10, 10);
    drag.move(30, 30);
    drag.up();
    expect(drag.takeClick()).toBe(false);
    drag.down(cid('d1'), 30, 30);
    drag.up();
    expect(drag.takeClick()).toBe(true);
  });

  it('moves without a press do nothing', () => {
    const sketch = aSketch();
    const drag = createDimensionDrag(sketch);
    drag.move(50, 50);
    drag.up();
    expect(sketch.calls).toEqual([]);
  });

  it('a cancelled drag still ends the move (the session keeps no half move)', () => {
    const sketch = aSketch();
    const drag = createDimensionDrag(sketch);
    drag.down(cid('d1'), 10, 10);
    drag.move(30, 30);
    drag.cancel();
    expect(sketch.calls).toEqual(['move d1 30 30', 'end']);
    expect(drag.takeClick()).toBe(false);
  });

  it('a cancelled press without a move does nothing', () => {
    const sketch = aSketch();
    const drag = createDimensionDrag(sketch);
    drag.down(cid('d1'), 10, 10);
    drag.cancel();
    drag.move(30, 30);
    expect(sketch.calls).toEqual([]);
  });
});
