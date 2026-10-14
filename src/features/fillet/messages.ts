import type { PluginMessages } from '@/plugin-api';

// Texts of the translation keys of the fillet (ADR 0014): the schema carries only keys,
// ui adds these dictionaries to vue-i18n. fillet.failed is the issue code of the builder for a
// fillet the kernel could not make (D6).

export const filletMessages: PluginMessages = Object.freeze<PluginMessages>({
  cs: Object.freeze({
    'fillet.label': 'Zaoblení',
    'fillet.edges': 'Hrany',
    'fillet.radius': 'Poloměr',
    'fillet.failed': 'Zaoblení se nepodařilo. Zkuste menší poloměr nebo jiné hrany.',
  }),
  en: Object.freeze({
    'fillet.label': 'Fillet',
    'fillet.edges': 'Edges',
    'fillet.radius': 'Radius',
    'fillet.failed': 'The fillet failed. Try a smaller radius or other edges.',
  }),
});
