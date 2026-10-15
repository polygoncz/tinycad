// Angle helpers shared by the drawing tools, the dimensions and the glyphs. No imports, so any
// file of sketcher can use it without an import cycle.

const FULL_TURN = 2 * Math.PI;

/** The counter-clockwise sweep from angle a to angle b in (0, 2π], like the arc of the drawing. */
export function ccwSweep(a: number, b: number): number {
  let sweep = b - a;
  while (sweep <= 0) sweep += FULL_TURN;
  while (sweep > FULL_TURN) sweep -= FULL_TURN;
  return sweep;
}
