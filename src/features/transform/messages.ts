import type { PluginMessages } from '@/plugin-api';

// Texts of the translation keys of the transform (ADR 0014): the schema and the modes of the
// manipulator carry only keys, ui adds these dictionaries to vue-i18n.

export const transformMessages: PluginMessages = Object.freeze<PluginMessages>({
  cs: Object.freeze({
    'transform.label': 'Transformace',
    'transform.bodies': 'Tělesa',
    'transform.pivot': 'Střed otáčení',
    'transform.pivot.bodiesCenter': 'Střed těles',
    'transform.pivot.origin': 'Počátek',
    'transform.pivot.point': 'Bod',
    'transform.pivotPoint': 'Bod otáčení',
    'transform.translate': 'Posun',
    'transform.rx': 'Otočení X',
    'transform.ry': 'Otočení Y',
    'transform.rz': 'Otočení Z',
    'transform.mode.free': 'Volný',
    'transform.mode.move': 'Posun',
    'transform.mode.rotate': 'Otočení',
    'transform.mode.pivot': 'Nastavit pivot',
  }),
  en: Object.freeze({
    'transform.label': 'Transform',
    'transform.bodies': 'Bodies',
    'transform.pivot': 'Pivot',
    'transform.pivot.bodiesCenter': 'Bodies center',
    'transform.pivot.origin': 'Origin',
    'transform.pivot.point': 'Point',
    'transform.pivotPoint': 'Pivot point',
    'transform.translate': 'Translation',
    'transform.rx': 'Rotation X',
    'transform.ry': 'Rotation Y',
    'transform.rz': 'Rotation Z',
    'transform.mode.free': 'Free',
    'transform.mode.move': 'Move',
    'transform.mode.rotate': 'Rotate',
    'transform.mode.pivot': 'Set pivot',
  }),
});
