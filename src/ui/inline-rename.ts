// Editing in place (M19.2, D5): a name or a value becomes a text field; Enter or leaving the
// field commits, Esc cancels. Shared by every inline field (TitleBar, the document list, the
// Timeline, the Browser and the dimensions of a sketch); plain values, no Vue, so it is testable
// in Node.

/**
 * Ends the running edit and returns its key (the document of the card, `true` for one field);
 * null when none runs. Enter removes the field, which may fire blur too: only the first commits.
 * `editing` is the state of the component (a Vue ref fits).
 */
export function finishEdit<K>(editing: { value: K | null }): K | null {
  const key = editing.value;
  editing.value = null;
  return key;
}
