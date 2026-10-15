import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DISPLAY_STYLE, DISPLAY_MODES } from '@/app';
import type { DisplayStyle } from '@/app';
import {
  chooseDisplayStyleItem,
  displayModeIcon,
  displayStyleMenuItems,
} from '@/ui/display-style/menu-items';
import type { DisplayStyleMenuItem } from '@/ui/display-style/menu-items';
import { cs } from '@/ui/i18n/cs';
import { en } from '@/ui/i18n/en';

function styleOf(change: Partial<DisplayStyle>): DisplayStyle {
  return { ...DEFAULT_DISPLAY_STYLE, ...change };
}

describe('displayStyleMenuItems', () => {
  it('lists the four modes in DISPLAY_MODES order, then edges, transparency and mesh', () => {
    const items = displayStyleMenuItems(DEFAULT_DISPLAY_STYLE);
    expect(items.map((item) => (item.kind === 'mode' ? item.mode : item.toggle))).toEqual([
      ...DISPLAY_MODES,
      'edges',
      'transparent',
      'mesh',
    ]);
  });

  it('checks only the current mode', () => {
    const items = displayStyleMenuItems(styleOf({ mode: 'hiddenVisible' }));
    const checked = items.filter((item) => item.kind === 'mode' && item.checked);
    expect(checked.map((item) => (item.kind === 'mode' ? item.mode : null))).toEqual([
      'hiddenVisible',
    ]);
  });

  it('reflects the toggles of the style', () => {
    const items = displayStyleMenuItems(styleOf({ edges: false, transparent: true, mesh: true }));
    const toggles = Object.fromEntries(
      items.flatMap((item) => (item.kind === 'toggle' ? [[item.toggle, item.checked]] : [])),
    );
    expect(toggles).toEqual({ edges: false, transparent: true, mesh: true });
  });

  it('enables every toggle in shaded', () => {
    const items = displayStyleMenuItems(styleOf({ mode: 'shaded' }));
    expect(items.every((item) => item.enabled)).toBe(true);
  });

  it.each(['hiddenRemoved', 'hiddenVisible', 'wireframe'] as const)(
    'greys out edges and transparency in %s, mesh stays enabled',
    (mode) => {
      const items = displayStyleMenuItems(styleOf({ mode }));
      const enabled = Object.fromEntries(
        items.map((item) => [item.kind === 'mode' ? item.mode : item.toggle, item.enabled]),
      );
      expect(enabled).toEqual({
        shaded: true,
        hiddenRemoved: true,
        hiddenVisible: true,
        wireframe: true,
        edges: false,
        transparent: false,
        mesh: true,
      });
    },
  );

  it('keeps the held value of a greyed-out toggle', () => {
    const items = displayStyleMenuItems(styleOf({ mode: 'wireframe', transparent: true }));
    const transparent = items.find(
      (item) => item.kind === 'toggle' && item.toggle === 'transparent',
    );
    expect(transparent?.checked).toBe(true);
  });

  it('has a text for every label in both languages', () => {
    for (const item of displayStyleMenuItems(DEFAULT_DISPLAY_STYLE)) {
      expect(cs[item.label], item.label).toBeTypeOf('string');
      expect(en[item.label], item.label).toBeTypeOf('string');
    }
    expect(cs['displayStyle.button']).toBe('Styl zobrazení');
    expect(en['displayStyle.button']).toBe('Display style');
  });
});

describe('displayModeIcon', () => {
  it('gives every mode its own Tabler icon', () => {
    const icons = DISPLAY_MODES.map(displayModeIcon);
    expect(new Set(icons).size).toBe(DISPLAY_MODES.length);
    for (const icon of icons) expect(icon).toMatch(/^ti-[a-z0-9-]+$/);
  });
});

describe('chooseDisplayStyleItem', () => {
  function fakeController() {
    return {
      setMode: vi.fn(),
      toggleEdges: vi.fn(),
      toggleTransparent: vi.fn(),
      toggleMesh: vi.fn(),
    };
  }

  function itemOf(style: DisplayStyle, key: string): DisplayStyleMenuItem {
    const item = displayStyleMenuItems(style).find(
      (i) => (i.kind === 'mode' ? i.mode : i.toggle) === key,
    );
    if (item === undefined) throw new Error(`no item ${key}`);
    return item;
  }

  it('a mode calls setMode and closes the menu', () => {
    const controller = fakeController();
    const result = chooseDisplayStyleItem(controller, itemOf(DEFAULT_DISPLAY_STYLE, 'wireframe'));
    expect(result).toBe('close');
    expect(controller.setMode).toHaveBeenCalledExactlyOnceWith('wireframe');
    expect(controller.toggleEdges).not.toHaveBeenCalled();
    expect(controller.toggleTransparent).not.toHaveBeenCalled();
    expect(controller.toggleMesh).not.toHaveBeenCalled();
  });

  it.each([
    ['edges', 'toggleEdges'],
    ['transparent', 'toggleTransparent'],
    ['mesh', 'toggleMesh'],
  ] as const)('the %s toggle calls %s and keeps the menu open', (toggle, method) => {
    const controller = fakeController();
    const result = chooseDisplayStyleItem(controller, itemOf(DEFAULT_DISPLAY_STYLE, toggle));
    expect(result).toBe('keepOpen');
    for (const name of ['setMode', 'toggleEdges', 'toggleTransparent', 'toggleMesh'] as const) {
      expect(controller[name]).toHaveBeenCalledTimes(name === method ? 1 : 0);
    }
  });

  it.each(['edges', 'transparent'] as const)(
    'a greyed-out %s toggle calls nothing and is ignored',
    (toggle) => {
      const controller = fakeController();
      const item = itemOf(styleOf({ mode: 'wireframe' }), toggle);
      expect(item.enabled).toBe(false);
      expect(chooseDisplayStyleItem(controller, item)).toBe('ignored');
      expect(controller.setMode).not.toHaveBeenCalled();
      expect(controller.toggleEdges).not.toHaveBeenCalled();
      expect(controller.toggleTransparent).not.toHaveBeenCalled();
      expect(controller.toggleMesh).not.toHaveBeenCalled();
    },
  );
});
