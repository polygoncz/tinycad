// The time of the last change in the document list (spec 11, "Seznam dokumentů"; M19.1 U11): one
// formatter for the whole list. The states of the list are DocumentListModel's (interaction, M20).

/**
 * Formats the time of the last change (ms since epoch) by the locale. Creating an
 * Intl.DateTimeFormat is costly, so the list makes one per locale, not one per card.
 */
export function updatedFormatter(locale: string): (updatedAt: number) => string {
  const format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  return (updatedAt) => format.format(updatedAt);
}
