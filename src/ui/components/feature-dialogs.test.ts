import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import FeatureDialog from './FeatureDialog.vue';
import { dialogFor, FEATURE_DIALOGS } from './feature-dialogs';

describe('feature dialogs (spec 11, "Vlastní dialog featury")', () => {
  it('has no own dialog in M13 and is frozen', () => {
    expect(Object.keys(FEATURE_DIALOGS)).toEqual([]);
    expect(Object.isFrozen(FEATURE_DIALOGS)).toBe(true);
  });

  it('an unknown type gets the generated FeatureDialog', () => {
    expect(dialogFor('extrude')).toBe(FeatureDialog);
    // Keys of Object.prototype are not entries.
    expect(dialogFor('constructor')).toBe(FeatureDialog);
  });

  it('a type with an entry gets its own component', () => {
    const Own = defineComponent({ name: 'OwnDialog', render: () => null });
    const dialogs = Object.freeze({ special: Own });
    expect(dialogFor('special', dialogs)).toBe(Own);
    expect(dialogFor('box', dialogs)).toBe(FeatureDialog);
  });
});
