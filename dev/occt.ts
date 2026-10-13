// Temporary dev page (M7, manual check of the OCCT worker in the browser). Not part of the app:
// remove or archive after M10. Plain DOM, no Vue.
//
// Shows that OCCT initialises off the main thread (a requestAnimationFrame counter keeps running
// while createOcctKernel() waits), then meshes a box and prints counts and timings.
import type { MeshQuality } from '@/kernel';
import { createOcctKernel } from '@/kernel-occt';

const quality: MeshQuality = { linearDeflection: 0.1, angularDeflection: 0.5 };

function element(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

const out = element('out');
const framesEl = element('frames');

function print(lines: readonly string[]): void {
  out.textContent = lines.join('\n');
}

/** Counts animation frames until stopped; the count shows whether the main thread stayed free. */
function startFrameCounter(): () => number {
  let frames = 0;
  let running = true;
  const tick = (): void => {
    if (!running) return;
    frames += 1;
    framesEl.textContent = String(frames);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => {
    running = false;
    return frames;
  };
}

function ms(start: number, end: number): string {
  return `${(end - start).toFixed(1)} ms`;
}

async function run(): Promise<void> {
  const stopFrames = startFrameCounter();
  const t0 = performance.now();
  const kernel = await createOcctKernel().finally(stopFrames);
  const tReady = performance.now();
  const framesDuringInit = stopFrames();

  try {
    const { shape } = await kernel.makeBox({ origin: [0, 0, 0], size: [10, 20, 30] });
    const tBox = performance.now();
    const mesh = await kernel.tessellate(shape, quality);
    const tMesh = performance.now();
    const bbox = await kernel.boundingBox(shape);
    const tBbox = performance.now();
    await kernel.release([shape]);
    const live = await kernel.liveHandleCount();

    print([
      `ready:           ${ms(t0, tReady)} (frames during init: ${String(framesDuringInit)})`,
      `makeBox:         ${ms(tReady, tBox)}`,
      `tessellate:      ${ms(tBox, tMesh)}`,
      `boundingBox:     ${ms(tMesh, tBbox)}`,
      '',
      `triangles:       ${String(mesh.indices.length / 3)}`,
      `faces:           ${String(mesh.faceRanges.length / 3)}`,
      `edges:           ${String(mesh.edgeRanges.length / 3)}`,
      `vertices:        ${String(mesh.positions.length / 3)}`,
      `bounding box:    min [${bbox.min.join(', ')}], max [${bbox.max.join(', ')}]`,
      `live handles:    ${String(live)} (after release)`,
    ]);
  } finally {
    kernel.dispose();
  }
}

run().catch((e: unknown) => {
  out.classList.add('error');
  out.textContent = `Error: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`;
  console.error(e);
});
