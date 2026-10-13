import type { PluginMessages } from '@/plugin-api';

// Texts of the translation keys of the box (ADR 0014): the schema carries only keys,
// ui adds these dictionaries to vue-i18n.

export const boxMessages: PluginMessages = Object.freeze<PluginMessages>({
  cs: Object.freeze({
    'box.label': 'Kvádr',
    'box.origin': 'Počátek',
    'box.width': 'Šířka',
    'box.depth': 'Hloubka',
    'box.height': 'Výška',
  }),
  en: Object.freeze({
    'box.label': 'Box',
    'box.origin': 'Origin',
    'box.width': 'Width',
    'box.depth': 'Depth',
    'box.height': 'Height',
  }),
});
