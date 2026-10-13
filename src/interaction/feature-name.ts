import type { PartStudioData } from '@/document';

/** "<label> <n>" with the smallest positive n whose name is not in the studio yet (spec 10). */
export function nextFeatureName(studio: PartStudioData, label: string): string {
  const taken = new Set(studio.features.map((f) => f.name));
  for (let n = 1; ; n++) {
    const name = `${label} ${String(n)}`;
    if (!taken.has(name)) return name;
  }
}
