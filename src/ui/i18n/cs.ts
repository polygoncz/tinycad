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
  'feature.edit': 'Úprava featury',
  'browser.body': 'Těleso {n}',

  // Param fields.
  'field.refs.count': 'Vybráno: {n}',
  'field.refs.pick': 'Vyberte v pohledu',
});
