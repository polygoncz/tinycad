import { describe, expect, it } from 'vitest';
import type { ParamIssue } from '@/document';
import { cs } from './cs';
import { en } from './en';
import { addPluginMessages, createUiI18n, issueText, pickLocale, setUiLocale } from './i18n';
import type { KeyValueStorage } from '../storage';
import type { LocaleEnv } from './i18n';

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

// Keys the domain and interaction hand to ui (ADR 0014): transaction label, body row name.
const DOMAIN_KEYS = ['feature.edit', 'browser.body'];

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

// Keys the components build at run time: save states, kernel states and toolbar groups.
const COMPOSED_KEYS = [
  'titleBar.persistence.saved',
  'titleBar.persistence.pending',
  'titleBar.persistence.error',
  'titleBar.locale.cs',
  'titleBar.locale.en',
  'toolbar.group.history',
  'toolbar.group.primitive',
  'toolbar.group.modify',
  'toolbar.group.construction',
  'toolbar.group.view',
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

  it.each([...ISSUE_CODES, ...DOMAIN_KEYS, ...ACTION_KEYS, ...COMPOSED_KEYS])(
    '%s has a text in cs and en',
    (key) => {
      expect(cs[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
    },
  );

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
});
