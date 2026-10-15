import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DISPLAY_STYLE,
  DISPLAY_MODES,
  TRANSPARENT_FACE_OPACITY,
  displayDrawsAo,
  resolveDisplay,
  samePlan,
  type DisplayMode,
  type DisplayPlan,
  type DisplayStyle,
} from '@/render/display-style';

function style(overrides: Partial<DisplayStyle> = {}): DisplayStyle {
  return { ...DEFAULT_DISPLAY_STYLE, ...overrides };
}

const PLAN: DisplayPlan = {
  faces: 'lit',
  faceOpacity: 1,
  edges: true,
  hiddenEdges: 'none',
  meshLines: false,
  xray: false,
  ao: false,
  scene: 'studio',
};

describe('display style values', () => {
  it('lists the modes in menu order and is frozen', () => {
    expect(DISPLAY_MODES).toEqual([
      'shaded',
      'realistic',
      'hiddenRemoved',
      'hiddenVisible',
      'wireframe',
    ]);
    expect(Object.isFrozen(DISPLAY_MODES)).toBe(true);
  });

  it('defaults to shaded with edges, opaque, without mesh lines and AO, frozen', () => {
    expect(DEFAULT_DISPLAY_STYLE).toEqual({
      mode: 'shaded',
      edges: true,
      transparent: false,
      mesh: false,
      ao: false,
    });
    expect(Object.isFrozen(DEFAULT_DISPLAY_STYLE)).toBe(true);
  });

  it('has the transparent face opacity of the spec', () => {
    expect(TRANSPARENT_FACE_OPACITY).toBe(0.35);
  });
});

describe('resolveDisplay', () => {
  it('shaded with edges: lit opaque faces, edges, no xray', () => {
    expect(resolveDisplay(style())).toEqual(PLAN);
  });

  it('shaded without edges: no edges', () => {
    expect(resolveDisplay(style({ edges: false }))).toEqual({ ...PLAN, edges: false });
  });

  it('shaded transparent: translucent lit faces, edges by style, xray', () => {
    const expected = { ...PLAN, faceOpacity: TRANSPARENT_FACE_OPACITY, xray: true };
    expect(resolveDisplay(style({ transparent: true }))).toEqual(expected);
    expect(resolveDisplay(style({ transparent: true, edges: false }))).toEqual({
      ...expected,
      edges: false,
    });
  });

  it('hiddenRemoved: flat faces with edges, no hidden edges, no xray', () => {
    expect(resolveDisplay(style({ mode: 'hiddenRemoved' }))).toEqual({ ...PLAN, faces: 'flat' });
  });

  it('hiddenVisible: flat faces with edges, dashed hidden edges, xray', () => {
    expect(resolveDisplay(style({ mode: 'hiddenVisible' }))).toEqual({
      ...PLAN,
      faces: 'flat',
      hiddenEdges: 'dashed',
      xray: true,
    });
  });

  it('wireframe: hidden faces with edges, xray', () => {
    expect(resolveDisplay(style({ mode: 'wireframe' }))).toEqual({
      ...PLAN,
      faces: 'hidden',
      xray: true,
    });
  });

  it('realistic: physical opaque faces, no edges, no xray, the realistic scene', () => {
    expect(resolveDisplay(style({ mode: 'realistic' }))).toEqual({
      ...PLAN,
      faces: 'physical',
      edges: false,
      scene: 'realistic',
    });
  });

  it('realistic with AO: the AO pass', () => {
    expect(resolveDisplay(style({ mode: 'realistic', ao: true })).ao).toBe(true);
  });

  it.each(DISPLAY_MODES.filter((m) => m !== 'realistic'))(
    'uses the studio scene in %s',
    (mode: DisplayMode) => {
      for (const transparent of [false, true]) {
        expect(resolveDisplay(style({ mode, transparent })).scene).toBe('studio');
      }
    },
  );

  it.each(DISPLAY_MODES)('propagates mesh lines in %s', (mode: DisplayMode) => {
    expect(resolveDisplay(style({ mode, mesh: true })).meshLines).toBe(true);
    expect(resolveDisplay(style({ mode, mesh: false })).meshLines).toBe(false);
  });

  it.each(DISPLAY_MODES.filter((m) => m !== 'shaded'))(
    'ignores edges and transparent in %s',
    (mode: DisplayMode) => {
      const base = resolveDisplay(style({ mode }));
      for (const edges of [false, true]) {
        for (const transparent of [false, true]) {
          expect(resolveDisplay(style({ mode, edges, transparent }))).toEqual(base);
        }
      }
    },
  );

  it('shaded with AO: the AO pass', () => {
    expect(resolveDisplay(style({ ao: true }))).toEqual({ ...PLAN, ao: true });
  });

  it('shaded transparent with AO: no AO pass (the faces write no depth)', () => {
    expect(resolveDisplay(style({ ao: true, transparent: true })).ao).toBe(false);
  });

  it.each(DISPLAY_MODES.filter((m) => m !== 'shaded' && m !== 'realistic'))(
    'ignores AO in %s',
    (mode: DisplayMode) => {
      expect(resolveDisplay(style({ mode, ao: true })).ao).toBe(false);
    },
  );

  it('AO changes no other field of the plan', () => {
    for (const mode of DISPLAY_MODES) {
      for (const transparent of [false, true]) {
        for (const edges of [false, true]) {
          for (const mesh of [false, true]) {
            const without = resolveDisplay(style({ mode, transparent, edges, mesh }));
            const withAo = resolveDisplay(style({ mode, transparent, edges, mesh, ao: true }));
            expect({ ...withAo, ao: without.ao }).toEqual(without);
          }
        }
      }
    }
  });

  it('returns a frozen plan', () => {
    for (const mode of DISPLAY_MODES) {
      expect(Object.isFrozen(resolveDisplay(style({ mode })))).toBe(true);
    }
  });
});

describe('samePlan', () => {
  it('is true for structurally equal plans', () => {
    expect(samePlan(PLAN, { ...PLAN })).toBe(true);
    expect(samePlan(resolveDisplay(style()), resolveDisplay(style()))).toBe(true);
  });

  const changes: readonly [string, Partial<DisplayPlan>][] = [
    ['faces', { faces: 'flat' }],
    ['faceOpacity', { faceOpacity: TRANSPARENT_FACE_OPACITY }],
    ['edges', { edges: false }],
    ['hiddenEdges', { hiddenEdges: 'dashed' }],
    ['meshLines', { meshLines: true }],
    ['xray', { xray: true }],
    ['ao', { ao: true }],
    ['scene', { scene: 'realistic' }],
  ];

  it.each(changes)('differs on %s', (_field, change) => {
    expect(samePlan(PLAN, { ...PLAN, ...change })).toBe(false);
    expect(samePlan({ ...PLAN, ...change }, PLAN)).toBe(false);
  });

  it('differs on any single field of a resolved plan, also one added later', () => {
    const plan = resolveDisplay(style());
    for (const key of Object.keys(plan)) {
      // A value of no field type: equal to nothing, so only the comparison of this key can
      // tell the plans apart. The cast lets the test cover fields it does not know by name.
      const changed = { ...plan, [key]: Symbol(key) };
      expect(samePlan(plan, changed), key).toBe(false);
      expect(samePlan(changed, plan), key).toBe(false);
    }
  });
});

describe('displayDrawsAo', () => {
  const cases: readonly [string, DisplayStyle, boolean][] = [
    ['opaque shaded with AO on', style({ mode: 'shaded', transparent: false, ao: true }), true],
    ['opaque shaded with AO off', style({ mode: 'shaded', transparent: false, ao: false }), false],
    [
      'transparent shaded with AO on',
      style({ mode: 'shaded', transparent: true, ao: true }),
      false,
    ],
    ['realistic with AO on', style({ mode: 'realistic', ao: true }), true],
    [
      'realistic, transparent, AO on',
      style({ mode: 'realistic', transparent: true, ao: true }),
      true,
    ],
    ['realistic with AO off', style({ mode: 'realistic', ao: false }), false],
    ['hiddenRemoved with AO on', style({ mode: 'hiddenRemoved', ao: true }), false],
    ['hiddenVisible with AO on', style({ mode: 'hiddenVisible', ao: true }), false],
    ['wireframe with AO on', style({ mode: 'wireframe', ao: true }), false],
  ];

  it.each(cases)('%s', (_name, value, expected) => {
    expect(displayDrawsAo(value)).toBe(expected);
  });

  it('equals the ao of the resolved plan for every combination', () => {
    for (const mode of DISPLAY_MODES) {
      for (const transparent of [false, true]) {
        for (const ao of [false, true]) {
          for (const edges of [false, true]) {
            for (const mesh of [false, true]) {
              const value = style({ mode, transparent, ao, edges, mesh });
              expect(displayDrawsAo(value)).toBe(resolveDisplay(value).ao);
            }
          }
        }
      }
    }
  });
});
