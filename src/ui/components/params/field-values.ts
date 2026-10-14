// Value conversions and texts of the param fields, kept out of the components so they run in Node
// tests.
// The document stores millimetres and radians (spec 01, "Souřadnice a jednotky"); the UI shows
// millimetres and degrees.

import type { HandleUnit } from '@/app';
import type { Vec3 } from '@/core';

/** Number typed by the user, '.' or ',' as the decimal mark; null for anything else. */
export function parseNumber(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Text of a numeric param value without floating point noise; '' for a non-number. */
export function formatNumber(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return String(Number(value.toFixed(6)));
}

/** The value of a 'point' param, or null when the document holds something else. */
export function asPoint(value: unknown): Vec3 | null {
  if (!Array.isArray(value)) return null;
  const items: readonly unknown[] = value;
  const [x, y, z] = items;
  if (items.length !== 3 || !isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) {
    return null;
  }
  return [x, y, z];
}

/** The point with one coordinate (0 = x, 1 = y, 2 = z) replaced. */
export function withCoordinate(point: Vec3, axis: 0 | 1 | 2, value: number): Vec3 {
  return [
    axis === 0 ? value : point[0],
    axis === 1 ? value : point[1],
    axis === 2 ? value : point[2],
  ];
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * The text of the value field of the manipulator HUD (spec 11, rules 7 and 8): millimetres or
 * degrees rounded to two decimals, the same numbers as in the fields and independent of the
 * language. The unit stands beside the input.
 */
export function handleValueNumber(value: number, unit: HandleUnit): string {
  return formatNumber(round2(unit === 'length' ? value : radToDeg(value)));
}

/**
 * The text of a sketch dimension (M19.2 D4): at most two decimals without trailing zeros
 * (83.523654 → '83.52', 40 → '40'); the model keeps the exact value.
 */
export function formatDimension(value: number): string {
  return formatNumber(round2(value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The translated text of the button of a RefListField: a key of the ui messages and its params. */
export interface RefListText {
  readonly key: 'field.refs.count' | 'field.refs.countPick';
  readonly params: { readonly n: number };
}

/**
 * Text of the button of a RefListField: the count of the selected references, and while the field
 * is active also the hint to pick in the view (R87), so the user sees the selection grow. A value
 * that is not a list counts as empty.
 */
export function refListText(value: unknown, active: boolean): RefListText {
  const n = Array.isArray(value) ? value.length : 0;
  return { key: active ? 'field.refs.countPick' : 'field.refs.count', params: { n } };
}
