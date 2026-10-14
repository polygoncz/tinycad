import type { PluginMessages } from '@/plugin-api';

// Texts of the translation keys of the extrude (ADR 0014): the schema carries only keys,
// ui adds these dictionaries to vue-i18n. extrude.group.merge is the heading of the targets,
// extrude.upToFace the issue code of the builder for a face it cannot extrude up to (M14).

export const extrudeMessages: PluginMessages = Object.freeze<PluginMessages>({
  cs: Object.freeze({
    'extrude.label': 'Vysunutí',
    'extrude.regions': 'Oblasti',
    'extrude.operation': 'Operace',
    'extrude.operation.new': 'Nové těleso',
    'extrude.operation.add': 'Přidat',
    'extrude.operation.remove': 'Odebrat',
    'extrude.operation.intersect': 'Průnik',
    'extrude.targets': 'Sloučit s',
    'extrude.group.merge': 'Cílová tělesa',
    'extrude.endType': 'Konec',
    'extrude.endType.blind': 'Do vzdálenosti',
    'extrude.endType.symmetric': 'Symetricky',
    'extrude.endType.upToFace': 'Po plochu',
    'extrude.distance': 'Vzdálenost',
    'extrude.upTo': 'Plocha',
    'extrude.upToFace': 'Plocha musí být rovinná, rovnoběžná se skicou a ve směru vysunutí',
    'extrude.flip': 'Opačný směr',
  }),
  en: Object.freeze({
    'extrude.label': 'Extrude',
    'extrude.regions': 'Regions',
    'extrude.operation': 'Operation',
    'extrude.operation.new': 'New body',
    'extrude.operation.add': 'Add',
    'extrude.operation.remove': 'Remove',
    'extrude.operation.intersect': 'Intersect',
    'extrude.targets': 'Merge with',
    'extrude.group.merge': 'Target bodies',
    'extrude.endType': 'End type',
    'extrude.endType.blind': 'Blind',
    'extrude.endType.symmetric': 'Symmetric',
    'extrude.endType.upToFace': 'Up to face',
    'extrude.distance': 'Distance',
    'extrude.upTo': 'Face',
    'extrude.upToFace':
      'The face must be planar, parallel to the sketch and in the extrude direction',
    'extrude.flip': 'Opposite direction',
  }),
});
