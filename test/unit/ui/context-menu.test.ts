import { describe, expect, it } from 'vitest';
import type { ContextMenuItem } from '@/ui/context-menu';
import { menuHasIcons } from '@/ui/context-menu';

function anItem(id: string, icon?: string): ContextMenuItem {
  return {
    id,
    label: id,
    shortcut: null,
    group: null,
    enabled: true,
    modes: ['model'],
    checked: null,
    ...(icon === undefined ? {} : { icon }),
  };
}

describe('menuHasIcons (spec 11, "ContextMenu")', () => {
  it('no item with an icon: no column of icons', () => {
    expect(menuHasIcons([anItem('file.exportStep'), anItem('file.exportDocument')])).toBe(false);
  });

  it('an empty menu has no column of icons', () => {
    expect(menuHasIcons([])).toBe(false);
  });

  it('one item with an icon is enough for the column', () => {
    expect(menuHasIcons([anItem('view.front'), anItem('view.fitAll', 'zoom-scan')])).toBe(true);
  });
});
