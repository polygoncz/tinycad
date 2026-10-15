import { describe, expect, it } from 'vitest';
import type { AxisId, BodyId, FeatureId, PlaneId, SketchId } from '@/document';
import type {
  BrowserAxisRow,
  BrowserBodyRow,
  BrowserPlaneRow,
  BrowserSketchRow,
} from '@/interaction';
import { browserTreeRows, navItemOf, rowKeyAction, treeKey } from '@/ui/tree-navigation';
import type { BrowserFolders, TreeNavItem } from '@/ui/tree-navigation';

function leaf(level: number): TreeNavItem {
  return { level, expandable: false, expanded: false };
}
function folder(level: number, expanded: boolean): TreeNavItem {
  return { level, expandable: true, expanded };
}

// The shape of the Browser: the root (always expanded, not a folder), a closed Origin, open
// Sketches with a sketch and its region, open Bodies with two bodies, and an empty open folder.
const ROOT: TreeNavItem = { level: 0, expandable: false, expanded: true };
const TREE: readonly TreeNavItem[] = [
  ROOT, // 0
  folder(1, false), // 1 Origin
  folder(1, true), // 2 Sketches
  leaf(2), // 3 sketch
  leaf(3), // 4 region
  folder(1, true), // 5 Bodies
  leaf(2), // 6 body
  leaf(2), // 7 body
];

describe('treeKey', () => {
  it('ArrowDown and ArrowUp move to the next and the previous row', () => {
    expect(treeKey(TREE, 0, 'ArrowDown')).toEqual({ focus: 1 });
    expect(treeKey(TREE, 4, 'ArrowDown')).toEqual({ focus: 5 });
    expect(treeKey(TREE, 5, 'ArrowUp')).toEqual({ focus: 4 });
  });

  it('ArrowDown on the last and ArrowUp on the first row do nothing', () => {
    expect(treeKey(TREE, 7, 'ArrowDown')).toBeNull();
    expect(treeKey(TREE, 0, 'ArrowUp')).toBeNull();
  });

  it('Home and End go to the first and the last row', () => {
    expect(treeKey(TREE, 5, 'Home')).toEqual({ focus: 0 });
    expect(treeKey(TREE, 1, 'End')).toEqual({ focus: 7 });
    expect(treeKey(TREE, 0, 'Home')).toEqual({ focus: 0 });
    expect(treeKey(TREE, 7, 'End')).toEqual({ focus: 7 });
  });

  it('ArrowRight opens a closed folder', () => {
    expect(treeKey(TREE, 1, 'ArrowRight')).toEqual({ toggle: 1 });
  });

  it('ArrowRight on an open folder moves to its first child', () => {
    expect(treeKey(TREE, 2, 'ArrowRight')).toEqual({ focus: 3 });
    expect(treeKey(TREE, 5, 'ArrowRight')).toEqual({ focus: 6 });
  });

  it('ArrowRight on the expanded root moves to its first child', () => {
    expect(treeKey(TREE, 0, 'ArrowRight')).toEqual({ focus: 1 });
  });

  it('ArrowRight on an open folder without children does nothing', () => {
    const items = [ROOT, folder(1, true), folder(1, false)];
    expect(treeKey(items, 1, 'ArrowRight')).toBeNull();
  });

  it('ArrowRight on a leaf does nothing', () => {
    expect(treeKey(TREE, 3, 'ArrowRight')).toBeNull();
    expect(treeKey(TREE, 7, 'ArrowRight')).toBeNull();
  });

  it('ArrowLeft closes an open folder', () => {
    expect(treeKey(TREE, 2, 'ArrowLeft')).toEqual({ toggle: 2 });
    expect(treeKey(TREE, 5, 'ArrowLeft')).toEqual({ toggle: 5 });
  });

  it('ArrowLeft on a closed folder or a leaf moves to the parent', () => {
    expect(treeKey(TREE, 1, 'ArrowLeft')).toEqual({ focus: 0 });
    expect(treeKey(TREE, 3, 'ArrowLeft')).toEqual({ focus: 2 });
    expect(treeKey(TREE, 4, 'ArrowLeft')).toEqual({ focus: 3 });
    expect(treeKey(TREE, 7, 'ArrowLeft')).toEqual({ focus: 5 });
  });

  it('ArrowLeft on the root does nothing', () => {
    expect(treeKey(TREE, 0, 'ArrowLeft')).toBeNull();
  });

  it('other keys, an index outside the list and an empty list give null', () => {
    expect(treeKey(TREE, 3, 'Enter')).toBeNull();
    expect(treeKey(TREE, 3, 'a')).toBeNull();
    expect(treeKey(TREE, 8, 'ArrowDown')).toBeNull();
    expect(treeKey(TREE, -1, 'Home')).toBeNull();
    expect(treeKey([], 0, 'Home')).toBeNull();
  });
});

// Test ids are trusted.
const plane = (id: string): BrowserPlaneRow => ({
  plane: id as PlaneId,
  label: `origin.plane.${id}`,
  visible: false,
  selected: false,
});
const axis = (id: string): BrowserAxisRow => ({
  axis: id as AxisId,
  label: `origin.axis.${id}`,
  visible: false,
  active: false,
});
const sketch = (id: string, regions: readonly string[] = []): BrowserSketchRow => ({
  sketch: `sketch:${id}` as SketchId,
  feature: id as FeatureId,
  name: id,
  selected: false,
  regions: regions.map((region, i) => ({ region, n: i + 1, selected: false })),
});
const body = (id: string): BrowserBodyRow => ({
  body: id as BodyId,
  name: { key: 'browser.body', n: 1 },
  userName: null,
  feature: 'f1' as FeatureId,
  visible: true,
  color: null,
  selected: false,
});

const ALL_OPEN: BrowserFolders = { origin: true, sketches: true, bodies: true };
const CONTENT = {
  planes: [plane('xy')],
  axes: [axis('z')],
  sketches: [sketch('s1', ['r1'])],
  bodies: [body('b1')],
};

describe('browserTreeRows', () => {
  it('lists document › Origin (planes, axes), Sketches (with regions), Bodies', () => {
    const rows = browserTreeRows({ folders: ALL_OPEN, ...CONTENT });
    expect(rows.map((r) => [r.key, r.level, r.expanded])).toEqual([
      ['document', 0, true],
      ['folder:origin', 1, true],
      ['plane:xy', 2, undefined],
      ['axis:z', 2, undefined],
      ['folder:sketches', 1, true],
      ['sketch:sketch:s1', 2, undefined],
      ['region:sketch:s1:r1', 3, undefined],
      ['folder:bodies', 1, true],
      ['body:b1', 2, undefined],
    ]);
  });

  it('a closed folder has no rows under it', () => {
    const rows = browserTreeRows({
      folders: { origin: false, sketches: true, bodies: false },
      ...CONTENT,
    });
    expect(rows.map((r) => [r.key, r.expanded])).toEqual([
      ['document', true],
      ['folder:origin', false],
      ['folder:sketches', true],
      ['sketch:sketch:s1', undefined],
      ['region:sketch:s1:r1', undefined],
      ['folder:bodies', false],
    ]);
  });

  it('the rows carry what the template binds', () => {
    const rows = browserTreeRows({ folders: ALL_OPEN, ...CONTENT });
    expect(rows[6]).toMatchObject({
      kind: 'region',
      sketch: CONTENT.sketches[0],
      region: { region: 'r1' },
    });
    expect(rows[8]).toMatchObject({ kind: 'body', row: CONTENT.bodies[0] });
  });
});

describe('navItemOf', () => {
  it('only a folder is expandable; the document root is expanded, a leaf is not', () => {
    const [root, origin, xy] = browserTreeRows({ folders: ALL_OPEN, ...CONTENT });
    expect(root && navItemOf(root)).toEqual({ level: 0, expandable: false, expanded: true });
    expect(origin && navItemOf(origin)).toEqual({ level: 1, expandable: true, expanded: true });
    expect(xy && navItemOf(xy)).toEqual({ level: 2, expandable: false, expanded: false });
  });
});

describe('rowKeyAction', () => {
  it('Enter: a sketch opens the sketcher, a body is renamed, the others act as a click', () => {
    expect(rowKeyAction('sketch', 'Enter')).toBe('editSketch');
    expect(rowKeyAction('body', 'Enter')).toBe('rename');
    for (const kind of ['document', 'folder', 'plane', 'axis', 'region'] as const)
      expect(rowKeyAction(kind, 'Enter')).toBe('activate');
  });

  it('the space bar is a click on every row', () => {
    for (const kind of ['document', 'folder', 'plane', 'axis', 'sketch', 'region', 'body'] as const)
      expect(rowKeyAction(kind, ' ')).toBe('activate');
  });

  it('Delete and Backspace delete only a sketch', () => {
    expect(rowKeyAction('sketch', 'Delete')).toBe('delete');
    expect(rowKeyAction('sketch', 'Backspace')).toBe('delete');
    expect(rowKeyAction('body', 'Delete')).toBeNull();
    expect(rowKeyAction('folder', 'Backspace')).toBeNull();
  });

  it('other keys are no action of the row (navigation or nothing)', () => {
    expect(rowKeyAction('sketch', 'ArrowDown')).toBeNull();
    expect(rowKeyAction('body', 'F10')).toBeNull();
  });
});
