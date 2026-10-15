import { describe, expect, it } from 'vitest';
import { BODY_MATERIALS, BUILT_IN_OPERATION_TYPES, BUILT_IN_PLUGINS } from '@/app';
import type { ParamIssue } from '@/document';
import { cs } from '@/ui/i18n/cs';
import { en } from '@/ui/i18n/en';
import {
  addPluginMessages,
  createUiI18n,
  issueText,
  pickLocale,
  setUiLocale,
} from '@/ui/i18n/i18n';
import type { KeyValueStorage } from '@/ui/storage';
import type { LocaleEnv } from '@/ui/i18n/i18n';

// Codes of validateAgainstSchema (spec 03, "Schéma featury"). ui may import only types from
// document, so the list is copied here; a new code fails this test until it has a text.
const ISSUE_CODES = [
  'param.missing',
  'param.unexpected',
  'param.wrongType',
  'param.notInteger',
  'param.belowMin',
  'param.atOrBelowMin',
  'param.aboveMax',
  'param.atOrAboveMax',
  'param.unknownOption',
  'param.tooFewRefs',
  'param.tooManyRefs',
  'param.invalidRef',
];

// Keys the domain and interaction hand to ui (ADR 0014): transaction label, body row name,
// label of the select tool (SELECT_TOOL.label), the ordinal texts of topo chips (D5 of M19.1).
const DOMAIN_KEYS = [
  'feature.edit',
  'browser.body',
  'tool.select',
  'ref.edge',
  'ref.face',
  'ref.vertex',
];

// Labels of the built-in actions of app (M10, Ú7b) and the UI-only rename item of the menu.
const ACTION_KEYS = [
  'undo',
  'redo',
  'feature.delete',
  'feature.suppress',
  'feature.edit',
  'feature.rename',
  'timeline.rollHere',
  'view.fitAll',
  'timeline.toStart',
  'timeline.stepBack',
  'timeline.stepForward',
  'timeline.toEnd',
];

// Keys the components build at run time (save states, locales, toolbar groups) and the kernel
// notices of the title bar.
const COMPOSED_KEYS = [
  'titleBar.persistence.saved',
  'titleBar.persistence.pending',
  'titleBar.persistence.error',
  'titleBar.kernel.restarting',
  'titleBar.kernel.failed',
  'titleBar.kernel.unavailable',
  'titleBar.locale.cs',
  'titleBar.locale.en',
  'toolbar.group.history',
  'toolbar.group.primitive',
  'toolbar.group.modify',
  'toolbar.group.construction',
  'toolbar.group.view',
];

// Keys of the sketcher (M12): labels of its tools and actions, the toolbar groups of the sketch
// mode, the composed constraint and status keys of the sketch panel and the Browser groups.
const SKETCH_KEYS = [
  'tool.sketch',
  'tool.line',
  'tool.rectangle',
  'tool.circle',
  'tool.arc',
  'tool.dimension',
  'toolbar.group.sketch',
  'toolbar.group.select',
  'toolbar.group.draw',
  'toolbar.group.constrain',
  'toolbar.group.finish',
  'sketch.finish',
  'sketch.cancel',
  'sketch.delete',
  'sketch.construction',
  'sketch.constraint.coincident',
  'sketch.constraint.horizontal',
  'sketch.constraint.vertical',
  'sketch.constraint.parallel',
  'sketch.constraint.perpendicular',
  'sketch.constraint.equal',
  'sketch.constraint.tangent',
  'sketch.constraint.midpoint',
  'sketch.constraint.fix',
  'sketch.constraint.pointOnCurve',
  'sketch.constraint.hAlign',
  'sketch.constraint.vAlign',
  'sketch.constraint.distance',
  'sketch.constraint.radius',
  'sketch.planeMissing',
  'sketch.status.defined',
  'sketch.status.dof',
  'sketch.status.solving',
  'sketch.conflict',
  'sketch.redundant',
  'sketch.solverFailed',
  'sketchPanel.constraints',
  'sketchPanel.remove',
  'browser.origin',
  'browser.sketches',
  'origin.plane.xy',
  'origin.plane.xz',
  'origin.plane.yz',
];

// Keys of Extrude and Revolve in ui (M13): the origin axes of the Browser (ORIGIN_AXES labels),
// the region rows and the texts of the axis field (RefText keys of interaction).
const SWEEP_KEYS = [
  'origin.axis.x',
  'origin.axis.y',
  'origin.axis.z',
  'browser.region',
  'field.noRef',
  'field.missingRef',
  'field.sketchLine',
  // M21: the text of a face as the plane of a sketch (field "Plane" of the sketch panel).
  'field.planeFace',
];

// Keys of the debug panel of topological names (M14, R111).
const DEBUG_KEYS = ['debug.topoNames', 'debug.unnamed', 'debug.face', 'debug.edge'];

// Keys of export, import, the history panel and the body colour (M15).
const FILE_KEYS = [
  'file.exportStep',
  'file.exportDocument',
  'titleBar.file',
  'file.running',
  'file.failed',
  'history.title',
  'history.undo',
  'history.redo',
  'history.older',
  'history.status.undone',
  'history.status.abandoned',
  'documents.import',
  'documents.importError',
  'browser.color',
  'browser.defaultColor',
];

// Keys of the view cube labels (M17), sent to the viewport by AppShell (viewCubeLabels).
const VIEW_CUBE_KEYS = [
  'viewCube.front',
  'viewCube.back',
  'viewCube.left',
  'viewCube.right',
  'viewCube.top',
  'viewCube.bottom',
  'viewCube.turnLeft',
  'viewCube.turnRight',
  'viewCube.turnUp',
  'viewCube.turnDown',
  'viewCube.rollClockwise',
  'viewCube.rollCounterClockwise',
  'viewCube.switchToFree',
  'viewCube.switchToTurntable',
];

// The aria-label of the value field of the manipulator HUD (M19, spec 11 rule 8).
const MANIPULATOR_KEYS = ['manipulator.field.label'];

// The material select of a body row in the Browser (M24, Q078).
const MATERIAL_KEYS = [
  'displayStyle.mode.realistic',
  'browser.material',
  ...BODY_MATERIALS.map((material) => `bodyMaterial.${material}`),
  'body.setMaterial',
];

const PLUGIN = {
  cs: { 'box.label': 'Kvádr', 'box.width': 'Šířka' },
  en: { 'box.label': 'Box', 'box.width': 'Width' },
};

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & {
  readonly data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

function env(stored: string | null, language: string): LocaleEnv {
  return {
    storage: memoryStorage(stored === null ? {} : { 'tinycad.locale': stored }),
    language,
  };
}

describe('built-in dictionaries', () => {
  it('cs and en have the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(cs).sort());
  });

  it.each([
    ...ISSUE_CODES,
    ...DOMAIN_KEYS,
    ...ACTION_KEYS,
    ...COMPOSED_KEYS,
    ...SKETCH_KEYS,
    ...SWEEP_KEYS,
    ...DEBUG_KEYS,
    ...FILE_KEYS,
    ...VIEW_CUBE_KEYS,
    ...MANIPULATOR_KEYS,
    ...MATERIAL_KEYS,
    // The types of the built-in operations (OP_VERSION of ops, through app): the dispatcher
    // writes the type as the label of an entry without one, so the history panel translates it
    // (spec 11, M15); a new type fails this test until it has a text.
    ...BUILT_IN_OPERATION_TYPES,
  ])('%s has a text in cs and en', (key) => {
    expect(cs[key]).toBeTruthy();
    expect(en[key]).toBeTruthy();
  });

  it('the texts of the built-in plugins do not clash with them (the sketch plugin included)', () => {
    const merged = (lang: 'cs' | 'en'): Record<string, string> =>
      Object.fromEntries(BUILT_IN_PLUGINS.flatMap((p) => Object.entries(p.messages?.[lang] ?? {})));
    const plugins = { cs: merged('cs'), en: merged('en') };
    expect(() => createUiI18n(plugins, { storage: null, language: 'cs' })).not.toThrow();
  });

  it('names the body materials and their select (M24)', () => {
    const names = (dict: Readonly<Record<string, string>>) =>
      BODY_MATERIALS.map((material) => dict[`bodyMaterial.${material}`]);
    expect(names(cs)).toEqual(['Plast', 'Hliník', 'Ocel', 'Mosaz', 'Sklo', 'Guma']);
    expect(names(en)).toEqual(['Plastic', 'Aluminium', 'Steel', 'Brass', 'Glass', 'Rubber']);
    expect(cs['browser.material']).toBe('Materiál {name}');
    expect(en['browser.material']).toBe('Material of {name}');
    expect(cs['body.setMaterial']).toBe('Materiál tělesa');
    expect(en['body.setMaterial']).toBe('Body material');
  });

  it('the unresolved reference speaks of any item, not only a body (R82)', () => {
    expect(cs['param.unresolvedRef']).toBe('Odkazovaná položka neexistuje');
    expect(en['param.unresolvedRef']).toBe('The referenced item does not exist');
  });

  it('a sketch without a plane asks for a new one (Q079)', () => {
    expect(cs['sketch.planeMissing']).toBe('Rovina skici chybí, vyberte novou');
    expect(en['sketch.planeMissing']).toBe('The sketch plane is missing, pick a new one');
  });

  it('are frozen', () => {
    expect(Object.isFrozen(cs)).toBe(true);
    expect(Object.isFrozen(en)).toBe(true);
  });
});

describe('pickLocale', () => {
  it('prefers a valid stored choice', () => {
    expect(pickLocale('en', 'cs-CZ')).toBe('en');
    expect(pickLocale('cs', 'en-US')).toBe('cs');
  });

  it('falls back to the browser language, English for unknown languages', () => {
    expect(pickLocale(null, 'cs-CZ')).toBe('cs');
    expect(pickLocale(null, 'cs')).toBe('cs');
    expect(pickLocale(null, 'en-GB')).toBe('en');
    expect(pickLocale(null, 'de-DE')).toBe('en');
    expect(pickLocale('fr', 'cs-CZ')).toBe('cs');
  });
});

describe('createUiI18n', () => {
  it('merges the built-in and the plugin dictionaries', () => {
    const i18n = createUiI18n(PLUGIN, env(null, 'cs-CZ'));
    const t = i18n.global.t;
    expect(t('box.width')).toBe('Šířka');
    expect(t('feature.edit')).toBe(cs['feature.edit']);
  });

  it('takes the locale from storage, then from the browser language', () => {
    expect(createUiI18n(PLUGIN, env('en', 'cs-CZ')).global.locale.value).toBe('en');
    expect(createUiI18n(PLUGIN, env(null, 'cs-CZ')).global.locale.value).toBe('cs');
    expect(createUiI18n(PLUGIN, { storage: null, language: 'de' }).global.locale.value).toBe('en');
  });

  it('rejects a plugin key that clashes with a built-in key', () => {
    const clash = { cs: { 'feature.edit': 'x' }, en: { 'feature.edit': 'x' } };
    expect(() => createUiI18n(clash, env(null, 'cs'))).toThrow(/feature\.edit/);
  });

  it('setUiLocale switches the language and remembers it', () => {
    const storage = memoryStorage();
    const i18n = createUiI18n(PLUGIN, { storage, language: 'cs' });
    setUiLocale(i18n, 'en', storage);
    expect(i18n.global.locale.value).toBe('en');
    expect(i18n.global.t('box.width')).toBe('Width');
    expect(storage.data.get('tinycad.locale')).toBe('en');
  });
});

describe('addPluginMessages', () => {
  const NONE = { cs: {}, en: {} };

  it('adds the dictionaries of the plugins to a running instance', () => {
    const i18n = createUiI18n(NONE, env('cs', 'cs'));
    addPluginMessages(i18n, PLUGIN);
    expect(i18n.global.t('box.width')).toBe('Šířka');
    setUiLocale(i18n, 'en', null);
    expect(i18n.global.t('box.width')).toBe('Width');
  });

  it('adding the same dictionaries again (next session) is fine', () => {
    const i18n = createUiI18n(NONE, env('cs', 'cs'));
    addPluginMessages(i18n, PLUGIN);
    addPluginMessages(i18n, PLUGIN);
    expect(i18n.global.t('box.label')).toBe('Kvádr');
  });

  it('rejects a plugin key that clashes with a built-in key', () => {
    const i18n = createUiI18n(NONE, env('cs', 'cs'));
    const clash = { cs: { undo: 'x' }, en: { undo: 'x' } };
    expect(() => {
      addPluginMessages(i18n, clash);
    }).toThrow(/undo/);
    expect(i18n.global.t('undo')).toBe(cs.undo);
  });
});

describe('issueText', () => {
  it('translates the code with its params', () => {
    const i18n = createUiI18n(PLUGIN, env('cs', 'cs'));
    const issue: ParamIssue = { param: 'height', code: 'param.atOrBelowMin', params: { min: 0 } };
    const text = issueText(i18n.global.t, issue);
    expect(text).toBe(cs['param.atOrBelowMin']?.replace('{min}', '0'));
    expect(text).toContain('0');
  });

  it('translates a code without params', () => {
    const i18n = createUiI18n(PLUGIN, env('en', 'en'));
    expect(issueText(i18n.global.t, { param: 'height', code: 'param.missing' })).toBe(
      en['param.missing'],
    );
  });

  // R27: the user counts items from 1, the data from 0.
  it('shows a numeric index from 1', () => {
    const i18n = createUiI18n(PLUGIN, env('cs', 'cs'));
    const issue: ParamIssue = { param: 'tools', code: 'param.duplicateRef', params: { index: 0 } };
    expect(issueText(i18n.global.t, issue)).toBe(cs['param.duplicateRef']?.replace('{index}', '1'));
  });

  it('leaves a non-numeric index as it is', () => {
    const calls: Record<string, unknown>[] = [];
    const t = (_key: string, named: Record<string, unknown>): string => {
      calls.push(named);
      return '';
    };
    issueText(t, { param: 'tools', code: 'param.duplicateRef', params: { index: 'a', n: 2 } });
    expect(calls).toEqual([{ index: 'a', n: 2 }]);
  });
});
