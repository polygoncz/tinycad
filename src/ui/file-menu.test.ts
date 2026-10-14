import { describe, expect, it } from 'vitest';
import type { ActionState } from '@/interaction';
import { fileMenuItems } from './file-menu';

function action(id: string, group: string | null, enabled = true): ActionState {
  return { id, label: id, shortcut: null, group, enabled, modes: ['model'] };
}

describe('fileMenuItems', () => {
  it('are the actions of the group file in registration order, disabled ones included', () => {
    const step = action('file.exportStep', 'file', false);
    const doc = action('file.exportDocument', 'file');
    const items = fileMenuItems([action('undo', null), step, action('view.fitAll', 'view'), doc]);
    expect(items).toEqual([step, doc]);
    expect(items[0]).toBe(step);
  });

  it('is empty without file actions', () => {
    expect(fileMenuItems([action('undo', null)])).toEqual([]);
  });
});
