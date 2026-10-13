// Built-in Czech texts of ui (ADR 0014). Keys of features live in their plugins' messages.
// vue-i18n message syntax: {name} is a param; '@', '|', '{' and '}' are special.

export const cs: Readonly<Record<string, string>> = Object.freeze({
  // Codes of validateAgainstSchema (spec 03, "Schéma featury").
  'param.missing': 'Chybí hodnota',
  'param.unexpected': 'Neznámý parametr',
  'param.wrongType': 'Neplatná hodnota',
  'param.notInteger': 'Musí být celé číslo',
  'param.belowMin': 'Musí být aspoň {min}',
  'param.atOrBelowMin': 'Musí být větší než {min}',
  'param.aboveMax': 'Může být nejvýš {max}',
  'param.atOrAboveMax': 'Musí být menší než {max}',
  'param.unknownOption': 'Neznámá možnost',
  'param.tooFewRefs': 'Vyberte aspoň {min}',
  'param.tooManyRefs': 'Vyberte nejvýš {max}',
  'param.invalidRef': 'Neplatná položka výběru',

  // Keys handed over by the domain and interaction.
  'document.untitled': 'Bez názvu',
  'feature.edit': 'Upravit featuru',
  'browser.body': 'Těleso {n}',

  // Labels of the built-in actions (app); feature.edit is above, it is a transaction label too.
  undo: 'Zpět',
  redo: 'Znovu',
  'feature.delete': 'Smazat',
  'feature.suppress': 'Potlačit',
  'feature.rename': 'Přejmenovat',
  'timeline.rollHere': 'Posunout bar sem',
  'view.fitAll': 'Zobrazit vše',
  'timeline.toStart': 'Na začátek',
  'timeline.stepBack': 'O krok zpět',
  'timeline.stepForward': 'O krok vpřed',
  'timeline.toEnd': 'Na konec',

  // Browser.
  'browser.title': 'Prohlížeč',
  'browser.bodies': 'Tělesa',
  'browser.show': 'Zobrazit',
  'browser.hide': 'Skrýt',

  // Timeline.
  'timeline.rollbackBar': 'Rollback bar – táhněte',
  'timeline.status.warning': 'Varování',
  'timeline.status.error': 'Chyba',
  'timeline.status.suppressed': 'Potlačeno',
  'timeline.status.rolledBack': 'Za rollback barem',
  'timeline.status.pending': 'Čeká na přepočet',
  'timeline.regen.busy': 'Přepočítávám…',
  'timeline.regen.errors': 'Chyby: {n}',
  'timeline.regen.ms': '{ms} ms',
  'timeline.bodies': 'Tělesa: {n}',
  'timeline.selected': 'Vybráno: {n}',

  // Param fields.
  'field.refs.count': 'Vybráno: {n}',
  'field.refs.pick': 'Vyberte v pohledu',
});
