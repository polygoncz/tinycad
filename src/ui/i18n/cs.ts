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
  'param.duplicateRef': 'Položka {index} je ve výběru dvakrát',
  'param.unresolvedRef': 'Odkazované těleso neexistuje',

  // Keys handed over by the domain and interaction.
  'document.untitled': 'Bez názvu',
  'feature.edit': 'Upravit featuru',
  'browser.body': 'Těleso {n}',
  'tool.select': 'Vybrat',
  'feature.delete.confirm': 'Počet featur, které ztratí referenci: {n}. Přesto smazat?',

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
  'timeline.dependents': 'Závisí na ní: {n}',

  // Param fields.
  'field.refs.count': 'Vybráno: {n}',
  'field.refs.pick': 'Vyberte v pohledu',

  // App: switching documents.
  'app.opening': 'Otevírám dokument…',
  'app.openError': 'Dokument se nepodařilo otevřít.',
  'app.backToList': 'Zpět na dokumenty',
  'app.closeError': 'Poslední změny předchozího dokumentu se nepodařilo uložit: {error}',
  'app.dismiss': 'Zavřít',

  // Title bar.
  'titleBar.documents': 'Dokumenty',
  'titleBar.readOnly': 'Jen pro čtení',
  'titleBar.readOnlyHint': 'Dokument je otevřený v jiné záložce. Změny zde nejsou možné.',
  'titleBar.persistence.saved': 'Uloženo',
  'titleBar.persistence.pending': 'Ukládám…',
  'titleBar.persistence.error': 'Uložení selhalo',
  'titleBar.kernel.restarting': 'Geometrické jádro se restartuje…',
  'titleBar.kernel.failed': 'Geometrické jádro opakovaně spadlo.',
  'titleBar.kernel.unavailable': 'Geometrické jádro se nepodařilo spustit.',
  'titleBar.kernel.reload': 'Obnovit stránku',
  'titleBar.language': 'Jazyk: {language}',
  'titleBar.locale.cs': 'čeština',
  'titleBar.locale.en': 'angličtina',
  'titleBar.themeDark': 'Tmavý režim',
  'titleBar.themeLight': 'Světlý režim',

  // Toolbar groups (toolbar.group.<id>; ToolDescriptor.group or history/view).
  'toolbar.group.history': 'Historie',
  'toolbar.group.primitive': 'Vytvořit',
  'toolbar.group.modify': 'Upravit',
  'toolbar.group.construction': 'Konstrukce',
  'toolbar.group.view': 'Zobrazit',
  'toolbar.group.select': 'Výběr',
  'toolbar.group.sketch': 'Skica',
  'toolbar.group.feature': 'Featury',

  // Feature dialog.
  'dialog.ok': 'OK',
  'dialog.cancel': 'Zrušit',
  'dialog.move': 'Přesunout',

  // Document list.
  'documents.title': 'Dokumenty',
  'documents.new': 'Nový',
  'documents.delete': 'Smazat dokument',
  'documents.confirmDelete': 'Smazat dokument „{name}“ i s historií?',
  'documents.loading': 'Načítám…',
  'documents.empty': 'Zatím tu nejsou žádné dokumenty.',
  'documents.error.list': 'Seznam dokumentů se nepodařilo načíst: {error}',
  'documents.error.create': 'Dokument se nepodařilo vytvořit: {error}',
  'documents.error.delete': 'Dokument se nepodařilo smazat: {error}',
});
