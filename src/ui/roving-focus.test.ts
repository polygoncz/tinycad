import { describe, expect, it } from 'vitest';
import { rovingActive, rovingNext } from './roving-focus';

describe('rovingNext', () => {
  it('the arrows move by one', () => {
    expect(rovingNext('ArrowRight', 1, 4)).toBe(2);
    expect(rovingNext('ArrowLeft', 1, 4)).toBe(0);
  });

  it('does not wrap: the ends stay where they are', () => {
    expect(rovingNext('ArrowLeft', 0, 4)).toBe(0);
    expect(rovingNext('ArrowRight', 3, 4)).toBe(3);
  });

  it('Home and End go to the first and the last', () => {
    expect(rovingNext('Home', 2, 4)).toBe(0);
    expect(rovingNext('End', 0, 4)).toBe(3);
  });

  it('other keys are not navigation', () => {
    expect(rovingNext('ArrowUp', 1, 4)).toBeNull();
    expect(rovingNext('Enter', 1, 4)).toBeNull();
    expect(rovingNext('a', 1, 4)).toBeNull();
  });

  it('no items: nowhere to go', () => {
    expect(rovingNext('ArrowRight', 0, 0)).toBeNull();
    expect(rovingNext('Home', 0, 0)).toBeNull();
  });
});

describe('rovingActive', () => {
  const row = (selected: boolean, editing: boolean) => ({ selected, editing });

  it('is the first selected item', () => {
    expect(rovingActive([row(false, true), row(true, false), row(true, false)])).toBe(1);
  });

  it('without a selection the edited item', () => {
    expect(rovingActive([row(false, false), row(false, true)])).toBe(1);
  });

  it('otherwise the first item, also of an empty list', () => {
    expect(rovingActive([row(false, false), row(false, false)])).toBe(0);
    expect(rovingActive([])).toBe(0);
  });
});
