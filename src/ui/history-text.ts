import type { HistoryRow } from '@/interaction';

// The texts of the history panel (spec 11, "Komponenty", M15). The label of a log entry is a
// translation key (a transaction label, or the op type the dispatcher writes for an operation
// without a label) or an untranslated text; undo and redo rows repeat the label of the original
// entry with a prefix. Pure functions, so HistoryPanel holds only bindings (rule 4).

export type HistoryTranslate = (key: string, params?: Record<string, unknown>) => string;

/** The text of a row: the label translated when the key exists (`te`), otherwise as it is. */
export function historyText(
  row: HistoryRow,
  t: HistoryTranslate,
  te: (key: string) => boolean,
): string {
  const label = te(row.label) ? t(row.label) : row.label;
  switch (row.kind) {
    case 'do':
      return label;
    case 'undo':
      return t('history.undo', { label });
    case 'redo':
      return t('history.redo', { label });
  }
}

/** The CSS class of a row: an undone entry grey and italic, an abandoned one struck through. */
export function historyRowClass(row: HistoryRow): 'undone' | 'abandoned' | null {
  return row.status === 'undone' || row.status === 'abandoned' ? row.status : null;
}

/** HH:MM:SS (24 hours) in the language `locale`; one formatter for all rows of the panel. */
export function historyTimeFormat(locale: string): (time: number) => string {
  const format = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return (time) => format.format(time);
}
