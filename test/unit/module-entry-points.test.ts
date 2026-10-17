import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ADR 0008: every module exposes its public API only through index.ts.
// The test lives in test/unit/ (ADR 0023); the modules are in src/.
const srcDir = join(import.meta.dirname, '../../src');

function moduleDirs(): string[] {
  const top = readdirSync(srcDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  // features/* and ui/* subfolders are not modules on their own except feature plugins.
  const plugins = readdirSync(join(srcDir, 'features'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `features/${e.name}`);
  return [...top.filter((m) => m !== 'features'), ...plugins];
}

describe('module entry points', () => {
  it.each(moduleDirs())('%s has index.ts', (dir) => {
    expect(existsSync(join(srcDir, dir, 'index.ts'))).toBe(true);
  });

  it('resolves the @/ alias to src/', async () => {
    await expect(import('@/core')).resolves.toBeDefined();
  });
});
