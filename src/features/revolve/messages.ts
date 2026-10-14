import type { PluginMessages } from '@/plugin-api';

// Texts of the translation keys of the revolve (ADR 0014): the schema carries only keys,
// ui adds these dictionaries to vue-i18n. revolve.group.merge is the heading of the targets.

export const revolveMessages: PluginMessages = Object.freeze<PluginMessages>({
  cs: Object.freeze({
    'revolve.label': 'Rotace',
    'revolve.regions': 'Oblasti',
    'revolve.axis': 'Osa',
    'revolve.operation': 'Operace',
    'revolve.operation.new': 'Nové těleso',
    'revolve.operation.add': 'Přidat',
    'revolve.operation.remove': 'Odebrat',
    'revolve.operation.intersect': 'Průnik',
    'revolve.targets': 'Sloučit s',
    'revolve.group.merge': 'Cílová tělesa',
    'revolve.angle': 'Úhel',
    'revolve.flip': 'Opačný směr',
  }),
  en: Object.freeze({
    'revolve.label': 'Revolve',
    'revolve.regions': 'Regions',
    'revolve.axis': 'Axis',
    'revolve.operation': 'Operation',
    'revolve.operation.new': 'New body',
    'revolve.operation.add': 'Add',
    'revolve.operation.remove': 'Remove',
    'revolve.operation.intersect': 'Intersect',
    'revolve.targets': 'Merge with',
    'revolve.group.merge': 'Target bodies',
    'revolve.angle': 'Angle',
    'revolve.flip': 'Opposite direction',
  }),
});
