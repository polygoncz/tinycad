// Built-in English texts of ui (ADR 0014). Same keys as cs.ts (checked by a test).

export const en: Readonly<Record<string, string>> = Object.freeze({
  // Codes of validateAgainstSchema (spec 03, "Schéma featury").
  'param.missing': 'Value is missing',
  'param.unexpected': 'Unknown parameter',
  'param.wrongType': 'Invalid value',
  'param.notInteger': 'Must be a whole number',
  'param.belowMin': 'Must be at least {min}',
  'param.atOrBelowMin': 'Must be greater than {min}',
  'param.aboveMax': 'Must be at most {max}',
  'param.atOrAboveMax': 'Must be less than {max}',
  'param.unknownOption': 'Unknown option',
  'param.tooFewRefs': 'Select at least {min}',
  'param.tooManyRefs': 'Select at most {max}',
  'param.invalidRef': 'Invalid selection item',

  // Keys handed over by the domain and interaction.
  'document.untitled': 'Untitled',
  'feature.edit': 'Edit feature',
  'browser.body': 'Body {n}',
  'tool.select': 'Select',

  // Labels of the built-in actions (app); feature.edit is above, it is a transaction label too.
  undo: 'Undo',
  redo: 'Redo',
  'feature.delete': 'Delete',
  'feature.suppress': 'Suppress',
  'feature.rename': 'Rename',
  'timeline.rollHere': 'Roll here',
  'view.fitAll': 'Fit all',
  'timeline.toStart': 'To start',
  'timeline.stepBack': 'Step back',
  'timeline.stepForward': 'Step forward',
  'timeline.toEnd': 'To end',

  // Browser.
  'browser.title': 'Browser',
  'browser.bodies': 'Bodies',
  'browser.show': 'Show',
  'browser.hide': 'Hide',

  // Timeline.
  'timeline.rollbackBar': 'Rollback bar – drag',
  'timeline.status.warning': 'Warning',
  'timeline.status.error': 'Error',
  'timeline.status.suppressed': 'Suppressed',
  'timeline.status.rolledBack': 'After the rollback bar',
  'timeline.status.pending': 'Waiting for regeneration',
  'timeline.regen.busy': 'Regenerating…',
  'timeline.regen.errors': 'Errors: {n}',
  'timeline.regen.ms': '{ms} ms',
  'timeline.bodies': 'Bodies: {n}',
  'timeline.selected': 'Selected: {n}',

  // Param fields.
  'field.refs.count': 'Selected: {n}',
  'field.refs.pick': 'Select in the view',

  // App: switching documents.
  'app.opening': 'Opening the document…',
  'app.openError': 'The document could not be opened.',
  'app.backToList': 'Back to documents',
  'app.closeError': 'The last changes of the previous document could not be saved: {error}',
  'app.dismiss': 'Dismiss',

  // Title bar.
  'titleBar.documents': 'Documents',
  'titleBar.readOnly': 'Read-only',
  'titleBar.readOnlyHint': 'The document is open in another tab. Changes are not possible here.',
  'titleBar.persistence.saved': 'Saved',
  'titleBar.persistence.pending': 'Saving…',
  'titleBar.persistence.error': 'Saving failed',
  'titleBar.kernel.restarting': 'The geometry kernel is restarting…',
  'titleBar.kernel.failed': 'The geometry kernel crashed repeatedly.',
  'titleBar.kernel.unavailable': 'The geometry kernel could not be started.',
  'titleBar.kernel.reload': 'Reload page',
  'titleBar.language': 'Language: {language}',
  'titleBar.locale.cs': 'Czech',
  'titleBar.locale.en': 'English',
  'titleBar.themeDark': 'Dark mode',
  'titleBar.themeLight': 'Light mode',

  // Toolbar groups (toolbar.group.<id>; ToolDescriptor.group or history/view).
  'toolbar.group.history': 'History',
  'toolbar.group.primitive': 'Create',
  'toolbar.group.modify': 'Modify',
  'toolbar.group.construction': 'Construct',
  'toolbar.group.view': 'View',
  'toolbar.group.select': 'Select',
  'toolbar.group.sketch': 'Sketch',
  'toolbar.group.feature': 'Features',

  // Feature dialog.
  'dialog.ok': 'OK',
  'dialog.cancel': 'Cancel',
  'dialog.move': 'Move',

  // Document list.
  'documents.title': 'Documents',
  'documents.new': 'New',
  'documents.delete': 'Delete document',
  'documents.confirmDelete': 'Delete the document “{name}” with its history?',
  'documents.loading': 'Loading…',
  'documents.empty': 'There are no documents yet.',
  'documents.error.list': 'The document list could not be loaded: {error}',
  'documents.error.create': 'The document could not be created: {error}',
  'documents.error.delete': 'The document could not be deleted: {error}',
});
