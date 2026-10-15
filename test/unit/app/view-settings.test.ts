import { describe, expect, it } from 'vitest';
import { DARK_PALETTE, LIGHT_PALETTE } from '@/render';
import type { AoSettings, DisplayStyle, ViewCubeLabels } from '@/render';
import { createViewSettings } from '@/app/view-settings';
import { FakeAppViewport } from '@/app/testing';

function setup(theme: 'light' | 'dark' = 'light') {
  const viewport = new FakeAppViewport();
  return { viewport, ...createViewSettings(viewport, theme) };
}

describe('createViewSettings', () => {
  it('setTheme picks the scene palette', () => {
    const { viewport, viewSettings } = setup();
    viewSettings.setTheme('dark');
    expect(viewport.palette).toBe(DARK_PALETTE);
    viewSettings.setTheme('light');
    expect(viewport.palette).toBe(LIGHT_PALETTE);
  });

  it('touches no palette before the first setTheme: the viewport was created with it', () => {
    const { viewport } = setup('dark');
    expect(viewport.palette).toBeNull();
  });

  it('defaultBodyColor starts with the face colour of the theme at the start', () => {
    expect(setup('light').defaultBodyColor.get()).toBe('#b9c3d1');
    expect(setup('dark').defaultBodyColor.get()).toBe('#3b6aa6');
  });

  it('defaultBodyColor follows setTheme', () => {
    const { viewSettings, defaultBodyColor } = setup();
    viewSettings.setTheme('dark');
    expect(defaultBodyColor.get()).toBe('#3b6aa6');
    viewSettings.setTheme('light');
    expect(defaultBodyColor.get()).toBe('#b9c3d1');
  });

  it('setViewCubeLabels hands the labels to the viewport unchanged (M17)', () => {
    const { viewport, viewSettings } = setup();
    const labels: ViewCubeLabels = {
      front: 'Přední',
      back: 'Zadní',
      left: 'Levá',
      right: 'Pravá',
      top: 'Horní',
      bottom: 'Dolní',
      turnLeft: 'Otočit doleva',
      turnRight: 'Otočit doprava',
      turnUp: 'Otočit nahoru',
      turnDown: 'Otočit dolů',
      rollClockwise: 'Natočit po směru hodinových ručiček',
      rollCounterClockwise: 'Natočit proti směru hodinových ručiček',
      switchToFree: 'Přepnout na volné otáčení',
      switchToTurntable: 'Přepnout na otáčení se svislou osou Z',
    };
    viewSettings.setViewCubeLabels(labels);
    expect(viewport.viewCubeLabels).toEqual([labels]);
    expect(viewport.viewCubeLabels[0]).toBe(labels);
  });

  it('setOrbitMode hands the mode to the viewport (M17.1)', () => {
    const { viewport, viewSettings } = setup();
    viewSettings.setOrbitMode('free');
    viewSettings.setOrbitMode('turntable');
    expect(viewport.orbitModes).toEqual(['free', 'turntable']);
  });

  it('a toggle request of the viewport reaches the listener until unsubscribed (M17.1)', () => {
    const { viewport, viewSettings } = setup();
    let toggles = 0;
    const off = viewSettings.onOrbitModeToggle(() => {
      toggles++;
    });
    viewport.emitOrbitModeToggle();
    expect(toggles).toBe(1);
    off();
    viewport.emitOrbitModeToggle();
    expect(toggles).toBe(1);
  });

  it('setDisplayStyle hands the style to the viewport unchanged (M22)', () => {
    const { viewport, viewSettings } = setup();
    const wireframe: DisplayStyle = {
      mode: 'wireframe',
      edges: true,
      transparent: false,
      mesh: true,
      ao: false,
    };
    const shaded: DisplayStyle = {
      mode: 'shaded',
      edges: false,
      transparent: true,
      mesh: false,
      ao: true,
    };
    viewSettings.setDisplayStyle(wireframe);
    viewSettings.setDisplayStyle(shaded);
    expect(viewport.displayStyles).toEqual([wireframe, shaded]);
    expect(viewport.displayStyles[0]).toBe(wireframe);
  });

  it('setAoSettings hands the settings to the viewport unchanged (M23)', () => {
    const { viewport, viewSettings } = setup();
    const settings: AoSettings = {
      radiusPx: 48,
      intensity: 0.5,
      thicknessPx: 8,
      distanceFallOff: 0.5,
      scale: 1.5,
      samples: 24,
    };
    viewSettings.setAoSettings(settings);
    expect(viewport.aoSettings).toEqual([settings]);
    expect(viewport.aoSettings[0]).toBe(settings);
  });
});
