import { describe, expect, it } from 'vitest';
import { cs } from '@/ui/i18n/cs';
import { en } from '@/ui/i18n/en';
import { viewCubeLabels } from '@/ui/view-cube-labels';

// The texts of spec 11 (M17, "Popisky view cube"), copied on purpose: a changed dictionary
// fails here until the spec agrees.
const CS = {
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

const EN = {
  front: 'Front',
  back: 'Back',
  left: 'Left',
  right: 'Right',
  top: 'Top',
  bottom: 'Bottom',
  turnLeft: 'Turn left',
  turnRight: 'Turn right',
  turnUp: 'Turn up',
  turnDown: 'Turn down',
  rollClockwise: 'Roll clockwise',
  rollCounterClockwise: 'Roll counterclockwise',
  switchToFree: 'Switch to free rotation',
  switchToTurntable: 'Switch to rotation with Z up',
};

function translate(dictionary: Readonly<Record<string, string>>): (key: string) => string {
  return (key) => {
    const text = dictionary[key];
    if (text === undefined) throw new Error(`No text for '${key}'`);
    return text;
  };
}

describe('viewCubeLabels', () => {
  it('translates the fourteen viewCube.* keys', () => {
    const keys: string[] = [];
    const labels = viewCubeLabels((key) => {
      keys.push(key);
      return key;
    });
    expect(Object.keys(labels).sort()).toEqual(Object.keys(EN).sort());
    expect(keys.sort()).toEqual(
      Object.keys(EN)
        .map((k) => `viewCube.${k}`)
        .sort(),
    );
    expect(labels.rollCounterClockwise).toBe('viewCube.rollCounterClockwise');
  });

  it('gives the Czech texts of the spec', () => {
    expect(viewCubeLabels(translate(cs))).toEqual(CS);
  });

  it('gives the English texts of the spec', () => {
    expect(viewCubeLabels(translate(en))).toEqual(EN);
  });
});
