import type { PluginMessages } from '@/plugin-api';

// Texts of the translation keys of the chamfer (ADR 0014): the schema carries only keys,
// ui adds these dictionaries to vue-i18n.

export const chamferMessages: PluginMessages = Object.freeze<PluginMessages>({
  cs: Object.freeze({
    'chamfer.label': 'Zkosení',
    'chamfer.edges': 'Hrany',
    'chamfer.distance': 'Vzdálenost',
  }),
  en: Object.freeze({
    'chamfer.label': 'Chamfer',
    'chamfer.edges': 'Edges',
    'chamfer.distance': 'Distance',
  }),
});
