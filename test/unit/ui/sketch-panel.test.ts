import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { ObservableValue } from '@/core';
import { constraintRowLabel, focusNewDimension, toggleShowAllConstraints } from '@/ui/sketch-panel';

describe('constraintRowLabel', () => {
  it('is the translated kind and the number of the row', () => {
    const t = (key: string): string => (key === 'sketch.constraint.distance' ? 'Vzdálenost' : key);
    expect(constraintRowLabel(t, { kind: 'distance', n: 2 })).toBe('Vzdálenost 2');
  });
});

describe('toggleShowAllConstraints (spec 12, "Glyfy vazeb (M25)", Panel)', () => {
  it('turns the switch of the editor to the other state', () => {
    const shown = new ObservableValue(false);
    const sketches = {
      showAllConstraints: shown.asObservable(),
      setShowAllConstraints: vi.fn((on: boolean) => {
        shown.set(on);
      }),
    };
    toggleShowAllConstraints(sketches);
    expect(sketches.setShowAllConstraints).toHaveBeenLastCalledWith(true);
    toggleShowAllConstraints(sketches);
    expect(sketches.setShowAllConstraints).toHaveBeenLastCalledWith(false);
  });
});

describe('focusNewDimension (spec 11, "Režim skici"; M25 collapsed list)', () => {
  function aField(): { focus: Mock; select: Mock } {
    return { focus: vi.fn(), select: vi.fn() };
  }

  it('opens the collapsed section after the tick and then focuses and selects the field', async () => {
    const order: string[] = [];
    const section = { open: false };
    const field = aField();
    field.focus.mockImplementation(() => order.push(`focus open=${String(section.open)}`));
    const tick = vi.fn(() => {
      order.push('tick');
      return Promise.resolve();
    });
    await focusNewDimension(
      tick,
      () => section,
      () => field,
    );
    expect(section.open).toBe(true);
    expect(order).toEqual(['tick', 'focus open=true']);
    expect(field.select).toHaveBeenCalledOnce();
  });

  it('leaves an open section open', async () => {
    const section = { open: true };
    await focusNewDimension(
      () => Promise.resolve(),
      () => section,
      () => aField(),
    );
    expect(section.open).toBe(true);
  });

  it('does nothing without the section or the field', async () => {
    await expect(
      focusNewDimension(
        () => Promise.resolve(),
        () => null,
        () => null,
      ),
    ).resolves.toBeUndefined();
  });
});
