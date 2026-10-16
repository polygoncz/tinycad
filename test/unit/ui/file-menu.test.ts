import { describe, expect, it } from 'vitest';
import type { ActionState } from '@/interaction';
import { fileMenuItems } from '@/ui/file-menu';

function action(id: string, group: string | null, enabled = true): ActionState {
  return { id, label: id, shortcut: null, group, enabled, modes: ['model'], checked: false };
}

const FILE_IDS = ['file.exportDocument', 'file.exportStep'];

describe('fileMenuItems', () => {
  it('are the File actions in registration order, disabled ones included', () => {
    const step = action('file.exportStep', 'file', false);
    const doc = action('file.exportDocument', 'file');
    const items = fileMenuItems(
      [action('undo', null), step, action('view.fitAll', 'view'), doc],
      FILE_IDS,
    );
    expect(items).toEqual([step, doc]);
    expect(items[0]).toBe(step);
  });

  it('go by the ids, not by the group', () => {
    const other = action('other', 'file');
    const step = action('file.exportStep', null);
    expect(fileMenuItems([other, step], FILE_IDS)).toEqual([step]);
  });

  it('is empty without file actions', () => {
    expect(fileMenuItems([action('undo', null)], FILE_IDS)).toEqual([]);
  });
});
