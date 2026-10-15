import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DISPLAY_STYLE, DISPLAY_MODES } from '@/app';
import type { DisplayStyle } from '@/app';
import {
  chooseDisplayStyleItem,
  displayModeIcon,
  displayStyleMenuItems,
  isAoDrawn,
} from '@/ui/display-style/menu-items';
import type { DisplayStyleMenuItem } from '@/ui/display-style/menu-items';
import { cs } from '@/ui/i18n/cs';
import { en } from '@/ui/i18n/en';

function styleOf(change: Partial<DisplayStyle>): DisplayStyle {
  return { ...DEFAULT_DISPLAY_STYLE, ...change };
}

function keyOf(item: DisplayStyleMenuItem): string {
  return item.key;
}

describe('displayStyleMenuItems', () => {
  it('lists the four modes in DISPLAY_MODES order, then edges, transparency, AO, AO settings and mesh', () => {
    const items = displayStyleMenuItems(DEFAULT_DISPLAY_STYLE);
    expect(items.map(keyOf)).toEqual([
      ...DISPLAY_MODES,
      'edges',
      'transparent',
      'ao',
      'aoSettings',
      'mesh',
    ]);
  });

  it('gives every item a unique key: the mode, the toggle or the command', () => {
    const items = displayStyleMenuItems(DEFAULT_DISPLAY_STYLE);
    for (const item of items) {
      const expected =
        item.kind === 'mode' ? item.mode : item.kind === 'toggle' ? item.toggle : item.command;
      expect(item.key).toBe(expected);
    }
    expect(new Set(items.map(keyOf)).size).toBe(items.length);
  });

  it('checks only the current mode', () => {
    const items = displayStyleMenuItems(styleOf({ mode: 'hiddenVisible' }));
    const checked = items.filter((item) => item.kind === 'mode' && item.checked);
    expect(checked.map((item) => (item.kind === 'mode' ? item.mode : null))).toEqual([
      'hiddenVisible',
    ]);
  });

  it('reflects the toggles of the style', () => {
    const items = displayStyleMenuItems(
      styleOf({ edges: false, transparent: true, mesh: true, ao: true }),
    );
    const toggles = Object.fromEntries(
      items.flatMap((item) => (item.kind === 'toggle' ? [[item.toggle, item.checked]] : [])),
    );
    expect(toggles).toEqual({ edges: false, transparent: true, mesh: true, ao: true });
  });

  it('enables every item in opaque shaded with AO on', () => {
    const items = displayStyleMenuItems(styleOf({ mode: 'shaded', transparent: false, ao: true }));
    expect(items.every((item) => item.enabled)).toBe(true);
  });

  it('greys out only the AO settings in opaque shaded with AO off', () => {
    const items = displayStyleMenuItems(styleOf({ mode: 'shaded', transparent: false, ao: false }));
    expect(items.filter((item) => !item.enabled).map(keyOf)).toEqual(['aoSettings']);
  });

  it('greys out only AO and its settings in transparent shaded and keeps the AO value', () => {
    const items = displayStyleMenuItems(styleOf({ mode: 'shaded', transparent: true, ao: true }));
    const disabled = items.filter((item) => !item.enabled);
    expect(disabled.map(keyOf)).toEqual(['ao', 'aoSettings']);
    expect(disabled[0]?.kind === 'toggle' && disabled[0].checked).toBe(true);
  });

  it.each(['hiddenRemoved', 'hiddenVisible', 'wireframe'] as const)(
    'greys out edges, transparency, AO and its settings in %s, mesh stays enabled',
    (mode) => {
      const items = displayStyleMenuItems(styleOf({ mode, ao: true }));
      const enabled = Object.fromEntries(items.map((item) => [keyOf(item), item.enabled]));
      expect(enabled).toEqual({
        shaded: true,
        hiddenRemoved: true,
        hiddenVisible: true,
        wireframe: true,
        edges: false,
        transparent: false,
        ao: false,
        aoSettings: false,
        mesh: true,
      });
    },
  );

  it('keeps the held value of a greyed-out toggle', () => {
    const items = displayStyleMenuItems(styleOf({ mode: 'wireframe', transparent: true }));
    const transparent = items.find(
      (item) => item.kind === 'toggle' && item.toggle === 'transparent',
    );
    expect(transparent?.kind === 'toggle' && transparent.checked).toBe(true);
  });

  it('has a text for every label in both languages', () => {
    for (const item of displayStyleMenuItems(DEFAULT_DISPLAY_STYLE)) {
      expect(cs[item.label], item.label).toBeTypeOf('string');
      expect(en[item.label], item.label).toBeTypeOf('string');
    }
    expect(cs['displayStyle.button']).toBe('Styl zobrazení');
    expect(en['displayStyle.button']).toBe('Display style');
    expect(cs['displayStyle.ao']).toBe('Ambientní okluze');
    expect(en['displayStyle.ao']).toBe('Ambient occlusion');
    expect(cs['displayStyle.aoSettings']).toBe('Nastavení AO…');
    expect(en['displayStyle.aoSettings']).toBe('AO settings…');
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
      toggleAo: vi.fn(),
    };
  }

  function itemOf(style: DisplayStyle, key: string): DisplayStyleMenuItem {
    const item = displayStyleMenuItems(style).find((i) => keyOf(i) === key);
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
    expect(controller.toggleAo).not.toHaveBeenCalled();
  });

  it.each([
    ['edges', 'toggleEdges'],
    ['transparent', 'toggleTransparent'],
    ['mesh', 'toggleMesh'],
    ['ao', 'toggleAo'],
  ] as const)('the %s toggle calls %s and keeps the menu open', (toggle, method) => {
    const controller = fakeController();
    const result = chooseDisplayStyleItem(controller, itemOf(DEFAULT_DISPLAY_STYLE, toggle));
    expect(result).toBe('keepOpen');
    const names = [
      'setMode',
      'toggleEdges',
      'toggleTransparent',
      'toggleMesh',
      'toggleAo',
    ] as const;
    for (const name of names) {
      expect(controller[name]).toHaveBeenCalledTimes(name === method ? 1 : 0);
    }
  });

  it.each([
    ['edges', 'wireframe', styleOf({ mode: 'wireframe' })],
    ['transparent', 'wireframe', styleOf({ mode: 'wireframe' })],
    ['ao', 'wireframe', styleOf({ mode: 'wireframe' })],
    ['ao', 'transparent shaded', styleOf({ mode: 'shaded', transparent: true })],
  ] as const)(
    'a greyed-out %s toggle in %s calls nothing and is ignored',
    (toggle, _where, style) => {
      const controller = fakeController();
      const item = itemOf(style, toggle);
      expect(item.enabled).toBe(false);
      expect(chooseDisplayStyleItem(controller, item)).toBe('ignored');
      expect(controller.setMode).not.toHaveBeenCalled();
      expect(controller.toggleEdges).not.toHaveBeenCalled();
      expect(controller.toggleTransparent).not.toHaveBeenCalled();
      expect(controller.toggleMesh).not.toHaveBeenCalled();
      expect(controller.toggleAo).not.toHaveBeenCalled();
    },
  );

  it('the AO settings item opens the panel and calls nothing', () => {
    const controller = fakeController();
    const item = itemOf(styleOf({ mode: 'shaded', transparent: false, ao: true }), 'aoSettings');
    expect(item.enabled).toBe(true);
    expect(chooseDisplayStyleItem(controller, item)).toBe('openAoSettings');
    for (const fn of Object.values(controller)) expect(fn).not.toHaveBeenCalled();
  });

  it.each([
    ['AO off', styleOf({ mode: 'shaded', transparent: false, ao: false })],
    ['transparent shaded', styleOf({ mode: 'shaded', transparent: true, ao: true })],
    ['wireframe', styleOf({ mode: 'wireframe', ao: true })],
  ] as const)('a greyed-out AO settings item with %s is ignored', (_where, style) => {
    const controller = fakeController();
    const item = itemOf(style, 'aoSettings');
    expect(item.enabled).toBe(false);
    expect(chooseDisplayStyleItem(controller, item)).toBe('ignored');
    for (const fn of Object.values(controller)) expect(fn).not.toHaveBeenCalled();
  });
});

describe('isAoDrawn', () => {
  it.each([
    ['opaque shaded with AO on', styleOf({ mode: 'shaded', transparent: false, ao: true }), true],
    ['AO off', styleOf({ mode: 'shaded', transparent: false, ao: false }), false],
    ['transparent shaded', styleOf({ mode: 'shaded', transparent: true, ao: true }), false],
    ['hiddenRemoved', styleOf({ mode: 'hiddenRemoved', ao: true }), false],
    ['wireframe', styleOf({ mode: 'wireframe', ao: true }), false],
  ] as const)('%s → %s', (_where, style, drawn) => {
    expect(isAoDrawn(style)).toBe(drawn);
  });
});
