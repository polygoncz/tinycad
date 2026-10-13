import type { PluginMessages } from '@/plugin-api';

// Texts of the translation keys of the transform (ADR 0014): the schema carries only keys,
// ui adds these dictionaries to vue-i18n.

export const transformMessages: PluginMessages = Object.freeze<PluginMessages>({
  cs: Object.freeze({
    'transform.label': 'Transformace',
    'transform.bodies': 'Tělesa',
    'transform.translate': 'Posun',
    'transform.axis': 'Osa rotace',
    'transform.axis.x': 'X',
    'transform.axis.y': 'Y',
    'transform.axis.z': 'Z',
    'transform.angle': 'Úhel',
  }),
  en: Object.freeze({
    'transform.label': 'Transform',
    'transform.bodies': 'Bodies',
    'transform.translate': 'Translation',
    'transform.axis': 'Rotation axis',
    'transform.axis.x': 'X',
    'transform.axis.y': 'Y',
    'transform.axis.z': 'Z',
    'transform.angle': 'Angle',
  }),
});
