import type { PluginMessages } from '@/plugin-api';

// Texts of the translation keys of the cylinder (ADR 0014): the schema carries only keys,
// ui adds these dictionaries to vue-i18n.

export const cylinderMessages: PluginMessages = Object.freeze<PluginMessages>({
  cs: Object.freeze({
    'cylinder.label': 'Válec',
    'cylinder.base': 'Střed podstavy',
    'cylinder.axis': 'Osa',
    'cylinder.axis.x': 'X',
    'cylinder.axis.y': 'Y',
    'cylinder.axis.z': 'Z',
    'cylinder.radius': 'Poloměr',
    'cylinder.height': 'Výška',
  }),
  en: Object.freeze({
    'cylinder.label': 'Cylinder',
    'cylinder.base': 'Base center',
    'cylinder.axis': 'Axis',
    'cylinder.axis.x': 'X',
    'cylinder.axis.y': 'Y',
    'cylinder.axis.z': 'Z',
    'cylinder.radius': 'Radius',
    'cylinder.height': 'Height',
  }),
});
