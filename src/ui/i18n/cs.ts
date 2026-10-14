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
  'param.unresolvedRef': 'Odkazovaná položka neexistuje',

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
  'browser.rename': 'Přejmenovat těleso',

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
  'field.refs.countPick': 'Vybráno: {n} · vyberte v pohledu',
  'field.refs.missing': 'Chybí těleso',
  'field.refs.remove': 'Odebrat {name}',
  // The axis field (M13): RefText keys of interaction and the empty value.
  'field.noRef': 'Nevybráno',
  'field.missingRef': 'Chybí položka',
  'field.sketchLine': 'Úsečka ze skici {sketch}',

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

  // Debug panel of topological names (M14, development only).
  'debug.topoNames': 'Jména ploch',
  'debug.unnamed': '(bez jména)',
  'debug.face': 'Plocha {index}',
  'debug.edge': 'Hrana {index}',

  // Toolbar groups (toolbar.group.<id>; ToolDescriptor.group or history/view).
  'toolbar.group.history': 'Historie',
  'toolbar.group.primitive': 'Vytvořit',
  'toolbar.group.modify': 'Upravit',
  'toolbar.group.construction': 'Konstrukce',
  'toolbar.group.view': 'Zobrazit',
  'toolbar.group.select': 'Výběr',
  'toolbar.group.sketch': 'Skica',
  'toolbar.group.feature': 'Featury',

  // Sketcher (M12): tools, toolbar groups, actions, constraints, the sketch panel.
  'tool.sketch': 'Skica',
  'tool.line': 'Úsečka',
  'tool.rectangle': 'Obdélník',
  'tool.circle': 'Kružnice',
  'tool.arc': 'Oblouk',
  'tool.dimension': 'Kóta',
  'toolbar.group.draw': 'Kreslit',
  'toolbar.group.constrain': 'Vazby',
  'toolbar.group.finish': 'Dokončit',
  'sketch.finish': 'Hotovo',
  'sketch.cancel': 'Zrušit skicu',
  'sketch.delete': 'Smazat',
  'sketch.construction': 'Konstrukční',
  'sketch.constraint.coincident': 'Shoda',
  'sketch.constraint.horizontal': 'Vodorovná',
  'sketch.constraint.vertical': 'Svislá',
  'sketch.constraint.parallel': 'Rovnoběžnost',
  'sketch.constraint.perpendicular': 'Kolmost',
  'sketch.constraint.equal': 'Shodná velikost',
  'sketch.constraint.tangent': 'Tečnost',
  'sketch.constraint.fix': 'Ukotvení',
  'sketch.constraint.distance': 'Vzdálenost',
  'sketch.constraint.radius': 'Poloměr',
  'sketch.status.defined': 'Plně určeno',
  'sketch.status.dof': 'Stupně volnosti: {n}',
  'sketch.status.solving': 'Řeším…',
  'sketch.conflict': 'Vazba je v rozporu s ostatními',
  'sketch.redundant': 'Vazba už platí',
  'sketch.solverFailed': 'Skicu se nepodařilo vyřešit',
  'sketchPanel.constraints': 'Vazby',
  'sketchPanel.remove': 'Odebrat {name}',

  // Browser: origin and sketches (M12).
  'browser.origin': 'Počátek',
  'browser.sketches': 'Skici',
  'origin.plane.xy': 'Horní (XY)',
  'origin.plane.xz': 'Přední (XZ)',
  'origin.plane.yz': 'Pravá (YZ)',

  // Browser: origin axes and sketch regions (M13).
  'origin.axis.x': 'Osa X',
  'origin.axis.y': 'Osa Y',
  'origin.axis.z': 'Osa Z',
  'browser.region': 'Oblast {n}',

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
  'documents.import': 'Importovat',
  'documents.importError': 'Soubor není platný dokument tinycad',

  // File menu and export (M15).
  'titleBar.file': 'Soubor',
  'file.exportStep': 'Exportovat STEP',
  'file.exportDocument': 'Exportovat dokument',
  'file.running': 'Exportuji…',
  'file.failed': 'Export se nezdařil',

  // History panel (M15).
  'history.title': 'Historie úprav',
  'history.undo': 'Zpět: {label}',
  'history.redo': 'Znovu: {label}',
  'history.older': 'Starší záznamy: {n}',
  'history.status.undone': 'vráceno',
  'history.status.abandoned': 'zahozeno',

  // Body colour in the Browser (M15).
  'browser.color': 'Barva {name}',
  'browser.defaultColor': 'Výchozí barva',

  // View cube (M17): face labels and the names of the arrows.
  'viewCube.front': 'Přední',
  'viewCube.back': 'Zadní',
  'viewCube.left': 'Levá',
  'viewCube.right': 'Pravá',
  'viewCube.top': 'Horní',
  'viewCube.bottom': 'Dolní',
  'viewCube.turnLeft': 'Otočit doleva',
  'viewCube.turnRight': 'Otočit doprava',
  'viewCube.turnUp': 'Otočit nahoru',
  'viewCube.turnDown': 'Otočit dolů',
  'viewCube.rollClockwise': 'Natočit po směru hodinových ručiček',
  'viewCube.rollCounterClockwise': 'Natočit proti směru hodinových ručiček',
  'viewCube.switchToFree': 'Přepnout na volné otáčení',
  'viewCube.switchToTurntable': 'Přepnout na otáčení se svislou osou Z',

  // The value field of the manipulator HUD (M19), its aria-label.
  'manipulator.field.label': 'Hodnota úchytu',

  // Labels of the built-in operations in the history panel: the dispatcher writes the op type
  // as the label of an entry without one. feature.rename and feature.suppress are above (actions).
  'feature.add': 'Přidat featuru',
  'feature.remove': 'Odebrat featuru',
  'feature.setParams': 'Změnit parametry',
  'feature.move': 'Přesunout featuru',
  'studio.setRollback': 'Posunout rollback bar',
  'body.rename': 'Přejmenovat těleso',
  'body.setVisible': 'Viditelnost tělesa',
  'body.setColor': 'Barva tělesa',
  batch: 'Více změn',
});
