import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { TEXT_FONTS } from '@/sketch';
import { createOpentypeOutliner, fontUrl } from '@/text-opentype';

// The URLs of the bundled fonts (spec 12 "Adaptér text-opentype"): the app fetches them, Vite
// bundles the files behind them. In Node the URL is the file next to the module.

describe('fontUrl', () => {
  it.each([
    ['sans', 'NotoSans-Regular.ttf'],
    ['serif', 'NotoSerif-Regular.ttf'],
    ['mono', 'NotoSansMono-Regular.ttf'],
  ] as const)('%s → fonts/%s', (font, file) => {
    expect(fontUrl(font)).toMatch(new RegExp(`/fonts/${file.replace('.', '\\.')}$`));
  });

  it('leads to a font the adapter outlines', async () => {
    const outliner = createOpentypeOutliner(async (font) => {
      const bytes = await readFile(new URL(fontUrl(font)));
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    });
    for (const font of TEXT_FONTS) {
      const contours = await outliner.outline({ text: 'o', font, height: 10 });
      expect(contours, font).toHaveLength(2);
    }
  });
});
