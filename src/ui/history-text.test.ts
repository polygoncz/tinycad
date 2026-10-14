import { describe, expect, it } from 'vitest';
import type { HistoryRow } from '@/interaction';
import { historyRowClass, historyText, historyTimeFormat } from './history-text';

const MESSAGES: Readonly<Record<string, string>> = {
  'feature.add': 'Přidat featuru',
  'history.undo': 'Zpět: {label}',
  'history.redo': 'Znovu: {label}',
};

function t(key: string, params?: Record<string, unknown>): string {
  const text = MESSAGES[key] ?? key;
  const label = params?.label;
  return typeof label === 'string' ? text.replace('{label}', label) : text;
}
function te(key: string): boolean {
  return key in MESSAGES;
}

function row(values: Partial<HistoryRow>): HistoryRow {
  return {
    seq: 1,
    kind: 'do',
    label: 'feature.add',
    time: 0,
    target: null,
    status: 'active',
    ...values,
  };
}

describe('historyText', () => {
  it('translates a label that has a key', () => {
    expect(historyText(row({}), t, te)).toBe('Přidat featuru');
  });

  it('shows an unknown label as it is', () => {
    expect(historyText(row({ label: 'Moje změna' }), t, te)).toBe('Moje změna');
  });

  it('prefixes undo and redo with the translated label', () => {
    const undo = row({ seq: 2, kind: 'undo', target: 1, status: null });
    const redo = row({ seq: 3, kind: 'redo', target: 1, status: null, label: 'raw' });
    expect(historyText(undo, t, te)).toBe('Zpět: Přidat featuru');
    expect(historyText(redo, t, te)).toBe('Znovu: raw');
  });
});

describe('historyRowClass', () => {
  it('marks undone and abandoned rows', () => {
    expect(historyRowClass(row({ status: 'active' }))).toBeNull();
    expect(historyRowClass(row({ status: 'undone' }))).toBe('undone');
    expect(historyRowClass(row({ status: 'abandoned' }))).toBe('abandoned');
    expect(historyRowClass(row({ kind: 'undo', status: null }))).toBeNull();
  });
});

describe('historyTimeFormat', () => {
  it('formats HH:MM:SS with 24 hours', () => {
    const time = new Date(2026, 9, 14, 14, 3, 9).getTime();
    expect(historyTimeFormat('cs')(time)).toBe('14:03:09');
    expect(historyTimeFormat('en')(time)).toBe('14:03:09');
  });
});
