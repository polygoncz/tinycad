import { describe, expect, it } from 'vitest';
import { inTextField, isMacPlatform, shortcutText, toViewKeyEvent } from '@/ui/keyboard';

const noMods = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
const body = { tagName: 'BODY', isContentEditable: false };
const input = (type: string) => ({ tagName: 'INPUT', type, isContentEditable: false });

describe('toViewKeyEvent', () => {
  it('copies key and modifiers', () => {
    const e = { key: 'Z', ...noMods, shiftKey: true, altKey: true, target: body };
    expect(toViewKeyEvent(e, false)).toEqual({
      key: 'Z',
      mods: { shift: true, alt: true, mod: false },
      inTextField: false,
    });
  });

  it('mod is Meta on Mac and Ctrl elsewhere', () => {
    const meta = { key: 'z', ...noMods, metaKey: true, target: body };
    const ctrl = { key: 'z', ...noMods, ctrlKey: true, target: body };
    expect(toViewKeyEvent(meta, true).mods.mod).toBe(true);
    expect(toViewKeyEvent(ctrl, true).mods.mod).toBe(false);
    expect(toViewKeyEvent(meta, false).mods.mod).toBe(false);
    expect(toViewKeyEvent(ctrl, false).mods.mod).toBe(true);
  });

  it('marks events from a text field', () => {
    const e = { key: 'Backspace', ...noMods, target: input('text') };
    expect(toViewKeyEvent(e, false).inTextField).toBe(true);
  });
});

describe('inTextField', () => {
  it.each(['text', 'number', 'search', 'email', 'password', 'url', 'tel', ''])(
    'input type "%s" is a text field',
    (type) => {
      expect(inTextField(input(type))).toBe(true);
    },
  );

  it.each(['checkbox', 'radio', 'button', 'submit', 'range', 'color'])(
    'input type "%s" is not a text field',
    (type) => {
      expect(inTextField(input(type))).toBe(false);
    },
  );

  it('textarea, select and contenteditable are text fields', () => {
    expect(inTextField({ tagName: 'TEXTAREA', isContentEditable: false })).toBe(true);
    expect(inTextField({ tagName: 'SELECT', isContentEditable: false })).toBe(true);
    expect(inTextField({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('other elements and non-elements are not', () => {
    expect(inTextField(body)).toBe(false);
    expect(inTextField({ tagName: 'BUTTON', isContentEditable: false })).toBe(false);
    expect(inTextField(null)).toBe(false);
    expect(inTextField(undefined)).toBe(false);
    expect(inTextField({})).toBe(false);
  });
});

describe('isMacPlatform', () => {
  it('recognizes Apple platforms by the user agent', () => {
    expect(isMacPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)')).toBe(true);
    expect(isMacPlatform('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe(true);
    expect(isMacPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false);
    expect(isMacPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe(false);
  });
});

describe('shortcutText', () => {
  it('shows macOS symbols on Mac', () => {
    expect(shortcutText('Mod+Shift+Z', true)).toBe('⌘⇧Z');
    expect(shortcutText('Delete', true)).toBe('⌫');
    expect(shortcutText('b', true)).toBe('B');
  });

  it('shows Ctrl and plus signs elsewhere', () => {
    expect(shortcutText('Mod+Shift+Z', false)).toBe('Ctrl+Shift+Z');
    expect(shortcutText('F', false)).toBe('F');
  });
});
