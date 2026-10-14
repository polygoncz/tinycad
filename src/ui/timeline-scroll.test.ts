import { describe, expect, it } from 'vitest';
import { scrollButtons } from './timeline-scroll';

describe('scrollButtons', () => {
  it('nothing to scroll: no buttons', () => {
    expect(scrollButtons(0, 500, 500)).toEqual({ left: false, right: false });
    expect(scrollButtons(0, 500, 300)).toEqual({ left: false, right: false });
  });

  it('at the start of a wider content only the right button', () => {
    expect(scrollButtons(0, 500, 900)).toEqual({ left: false, right: true });
  });

  it('in the middle both buttons', () => {
    expect(scrollButtons(200, 500, 900)).toEqual({ left: true, right: true });
  });

  it('at the end only the left button', () => {
    expect(scrollButtons(400, 500, 900)).toEqual({ left: true, right: false });
  });

  it('a fraction of a pixel from either end counts as the end (1 px tolerance)', () => {
    expect(scrollButtons(0.6, 500, 900)).toEqual({ left: false, right: true });
    expect(scrollButtons(399.2, 500, 900)).toEqual({ left: true, right: false });
    expect(scrollButtons(0, 500, 501)).toEqual({ left: false, right: false });
  });

  it('just over the tolerance shows the button', () => {
    expect(scrollButtons(1.5, 500, 900)).toEqual({ left: true, right: true });
    expect(scrollButtons(398.5, 500, 900)).toEqual({ left: true, right: true });
  });
});
