import { assertNever } from '@/core';
import type { TextFontId } from '@/sketch';

/**
 * The URL of a bundled font file (spec 12 "Adaptér text-opentype"), for the app to fetch. Each
 * `new URL('./fonts/…', import.meta.url)` is a literal Vite finds, so the build copies the font
 * into its assets; in Node it is the file next to this module.
 */
export function fontUrl(font: TextFontId): string {
  switch (font) {
    case 'sans':
      return new URL('./fonts/NotoSans-Regular.ttf', import.meta.url).href;
    case 'serif':
      return new URL('./fonts/NotoSerif-Regular.ttf', import.meta.url).href;
    case 'mono':
      return new URL('./fonts/NotoSansMono-Regular.ttf', import.meta.url).href;
    default:
      return assertNever(font);
  }
}
