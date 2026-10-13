import type { PluginMessages } from '@/plugin-api';

// Texts of the translation keys of the boolean (ADR 0014): the schema carries only keys,
// ui adds these dictionaries to vue-i18n. boolean.sameBody is the code of its own rule.

export const booleanMessages: PluginMessages = Object.freeze<PluginMessages>({
  cs: Object.freeze({
    'boolean.label': 'Boolean',
    'boolean.op': 'Operace',
    'boolean.op.union': 'Sjednocení',
    'boolean.op.subtract': 'Rozdíl',
    'boolean.op.intersect': 'Průnik',
    'boolean.targets': 'Cíle',
    'boolean.tools': 'Nástroje',
    'boolean.keepTools': 'Ponechat nástroje',
    'boolean.sameBody': 'Těleso {index} je zároveň cílem',
  }),
  en: Object.freeze({
    'boolean.label': 'Boolean',
    'boolean.op': 'Operation',
    'boolean.op.union': 'Union',
    'boolean.op.subtract': 'Subtract',
    'boolean.op.intersect': 'Intersect',
    'boolean.targets': 'Targets',
    'boolean.tools': 'Tools',
    'boolean.keepTools': 'Keep tools',
    'boolean.sameBody': 'Body {index} is also a target',
  }),
});
