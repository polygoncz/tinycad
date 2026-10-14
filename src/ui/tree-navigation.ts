// The tree of the Browser (M19.2, D14, revision U3): the ARIA pattern `tree` over a flat list of
// the visible rows with their levels. The list itself (browserTreeRows), the keyboard navigation
// (treeKey) and what a key does on a row (rowKeyAction) are pure functions kept out of
// Browser.vue so they run in Node tests. The rows of collapsed folders are not in the list.

import type {
  BrowserAxisRow,
  BrowserBodyRow,
  BrowserPlaneRow,
  BrowserRegionRow,
  BrowserSketchRow,
} from '@/interaction';

/** The collapsible sections of the Browser under the document. */
export type BrowserFolder = 'origin' | 'sketches' | 'bodies';
/** Which sections are open; view state of the Browser only. */
export type BrowserFolders = Readonly<Record<BrowserFolder, boolean>>;

/**
 * A visible row of the tree; the template and the keyboard share the list. `key` is unique and
 * stable (the roving focus remembers it), `level` 0 is the document, `expanded` the value of
 * aria-expanded (undefined for a row without children).
 */
export type BrowserTreeRow =
  | { readonly kind: 'document'; readonly key: string; readonly level: 0; readonly expanded: true }
  | {
      readonly kind: 'folder';
      readonly key: string;
      readonly level: 1;
      readonly expanded: boolean;
      readonly folder: BrowserFolder;
    }
  | {
      readonly kind: 'plane';
      readonly key: string;
      readonly level: 2;
      readonly expanded: undefined;
      readonly row: BrowserPlaneRow;
    }
  | {
      readonly kind: 'axis';
      readonly key: string;
      readonly level: 2;
      readonly expanded: undefined;
      readonly row: BrowserAxisRow;
    }
  | {
      readonly kind: 'sketch';
      readonly key: string;
      readonly level: 2;
      readonly expanded: undefined;
      readonly row: BrowserSketchRow;
    }
  | {
      readonly kind: 'region';
      readonly key: string;
      readonly level: 3;
      readonly expanded: undefined;
      readonly sketch: BrowserSketchRow;
      readonly region: BrowserRegionRow;
    }
  | {
      readonly kind: 'body';
      readonly key: string;
      readonly level: 2;
      readonly expanded: undefined;
      readonly row: BrowserBodyRow;
    };

/**
 * The visible rows in the order of the Browser: document › Origin (planes, axes), Sketches
 * (each with its regions), Bodies. A closed folder is listed without its rows.
 */
export function browserTreeRows(input: {
  readonly folders: BrowserFolders;
  readonly planes: readonly BrowserPlaneRow[];
  readonly axes: readonly BrowserAxisRow[];
  readonly sketches: readonly BrowserSketchRow[];
  readonly bodies: readonly BrowserBodyRow[];
}): readonly BrowserTreeRow[] {
  const { folders } = input;
  const folder = (name: BrowserFolder): BrowserTreeRow => ({
    kind: 'folder',
    key: `folder:${name}`,
    level: 1,
    expanded: folders[name],
    folder: name,
  });
  const leaf = { level: 2, expanded: undefined } as const;
  const list: BrowserTreeRow[] = [{ kind: 'document', key: 'document', level: 0, expanded: true }];
  list.push(folder('origin'));
  if (folders.origin) {
    for (const row of input.planes)
      list.push({ kind: 'plane', key: `plane:${row.plane}`, ...leaf, row });
    for (const row of input.axes)
      list.push({ kind: 'axis', key: `axis:${row.axis}`, ...leaf, row });
  }
  list.push(folder('sketches'));
  if (folders.sketches) {
    for (const row of input.sketches) {
      list.push({ kind: 'sketch', key: `sketch:${row.sketch}`, ...leaf, row });
      for (const region of row.regions)
        list.push({
          kind: 'region',
          key: `region:${row.sketch}:${region.region}`,
          level: 3,
          expanded: undefined,
          sketch: row,
          region,
        });
    }
  }
  list.push(folder('bodies'));
  if (folders.bodies) {
    for (const row of input.bodies)
      list.push({ kind: 'body', key: `body:${row.body}`, ...leaf, row });
  }
  return list;
}

/** The row as treeKey sees it: only a folder opens and closes; the document is always open. */
export function navItemOf(row: BrowserTreeRow): TreeNavItem {
  return { level: row.level, expandable: row.kind === 'folder', expanded: row.expanded === true };
}

/** What a key does on a row of the Browser, besides the navigation of treeKey. */
export type RowKeyAction = 'activate' | 'editSketch' | 'rename' | 'delete';

/**
 * The action of `key` on a row of the kind `kind` (D14):
 * - Enter: a sketch opens the sketcher, a body is renamed, any other row acts as a click
 *   (a folder opens or closes);
 * - the space bar: a click (selection, with Ctrl/Cmd added);
 * - Delete and Backspace (the "delete" key of a Mac keyboard): only a sketch is deleted.
 * null = no action of the row; the key is navigation (treeKey) or nothing.
 */
export function rowKeyAction(kind: BrowserTreeRow['kind'], key: string): RowKeyAction | null {
  switch (key) {
    case 'Enter':
      return kind === 'sketch' ? 'editSketch' : kind === 'body' ? 'rename' : 'activate';
    case ' ':
      return 'activate';
    case 'Delete':
    case 'Backspace':
      return kind === 'sketch' ? 'delete' : null;
    default:
      return null;
  }
}

/** A visible row of the tree as the navigation sees it. */
export interface TreeNavItem {
  /** 0 = the root; a child has the level of its parent + 1 and follows it in the list. */
  readonly level: number;
  /** The row is a folder the user can open and close. */
  readonly expandable: boolean;
  /** The children of the row are shown (the list has them right after it). */
  readonly expanded: boolean;
}

/** What a key does: move the focus to a row, open or close a folder, or nothing (null). */
export type TreeKeyResult = { readonly focus: number } | { readonly toggle: number } | null;

/**
 * The result of `key` (KeyboardEvent.key) on the row `index` of the visible rows `items`:
 * - ArrowDown / ArrowUp: the next / the previous row; past the last / the first one nothing
 *   (no wrap).
 * - ArrowRight: a closed folder opens; an expanded row moves to its first child (nothing without
 *   children); a leaf does nothing.
 * - ArrowLeft: an open folder closes; otherwise the focus goes to the parent (nothing on the root).
 * - Home / End: the first / the last row.
 * Another key, an index outside the list or an empty list → null.
 */
export function treeKey(items: readonly TreeNavItem[], index: number, key: string): TreeKeyResult {
  const item = items[index];
  if (item === undefined) return null;
  switch (key) {
    case 'ArrowDown':
      return index + 1 < items.length ? { focus: index + 1 } : null;
    case 'ArrowUp':
      return index > 0 ? { focus: index - 1 } : null;
    case 'Home':
      return { focus: 0 };
    case 'End':
      return { focus: items.length - 1 };
    case 'ArrowRight': {
      if (item.expandable && !item.expanded) return { toggle: index };
      const next = items[index + 1];
      return item.expanded && next !== undefined && next.level === item.level + 1
        ? { focus: index + 1 }
        : null;
    }
    case 'ArrowLeft': {
      if (item.expandable && item.expanded) return { toggle: index };
      const parent = parentIndex(items, index);
      return parent === null ? null : { focus: parent };
    }
    default:
      return null;
  }
}

/** The nearest previous row with a lower level; null for a row on the top level. */
function parentIndex(items: readonly TreeNavItem[], index: number): number | null {
  const level = items[index]?.level ?? 0;
  for (let i = index - 1; i >= 0; i--) {
    if ((items[i]?.level ?? 0) < level) return i;
  }
  return null;
}
