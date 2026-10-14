import type { PluginMessages } from '@/plugin-api';

// Texts of the translation keys of the fillet (ADR 0014): the schema carries only keys,
// ui adds these dictionaries to vue-i18n.

export const filletMessages: PluginMessages = Object.freeze<PluginMessages>({
  cs: Object.freeze({
    'fillet.label': 'Zaoblení',
    'fillet.edges': 'Hrany',
    'fillet.radius': 'Poloměr',
  }),
  en: Object.freeze({
    'fillet.label': 'Fillet',
    'fillet.edges': 'Edges',
    'fillet.radius': 'Radius',
  }),
});
