import type { PluginMessages } from '@/plugin-api';

// Texts of the translation keys of the chamfer (ADR 0014): the schema carries only keys,
// ui adds these dictionaries to vue-i18n. chamfer.failed is the issue code of the builder for a
// chamfer the kernel could not make (D6).

export const chamferMessages: PluginMessages = Object.freeze<PluginMessages>({
  cs: Object.freeze({
    'chamfer.label': 'Zkosení',
    'chamfer.edges': 'Hrany',
    'chamfer.distance': 'Vzdálenost',
    'chamfer.failed': 'Zkosení se nepodařilo. Zkuste menší vzdálenost nebo jiné hrany.',
  }),
  en: Object.freeze({
    'chamfer.label': 'Chamfer',
    'chamfer.edges': 'Edges',
    'chamfer.distance': 'Distance',
    'chamfer.failed': 'The chamfer failed. Try a smaller distance or other edges.',
  }),
});
