// Temporary dev page (M8, manual check of the viewport in the browser). Not part of the app:
// remove or archive after M10. Plain DOM, no Vue.
//
// The whole chain without app: OCCT kernel, a document with two boxes made through operations,
// regeneration, viewport.bodies.sync. A field for the height of box A (operation → regeneration →
// sync), buttons for the standard views and fit all, a counter of drawn frames (it must stay
// still while nothing happens), live WebGL buffers, the last viewport events and the result of
// viewport.pick under the cursor. Hover and selection through viewport.highlight (the selection
// logic lives only here; it moves to interaction in M9) and a sample overlay behind a checkbox.
//
// Composition as app will do it in M10; until then it lives here.
import type { DocumentId, FeatureId, FeatureInstance } from '@/document';
import { createDocument, createFeatureSchemaRegistry } from '@/document';
import { boxPlugin, type BoxParams } from '@/features/box';
import type { OverlayShape, PickResult, ViewKeyEvent, ViewPointerEvent } from '@/interaction';
import { createOcctKernel } from '@/kernel-occt';
import {
  createOperationDispatcher,
  createOperationLog,
  createOpHandlerRegistry,
  type FeatureAddOp,
  type FeatureSetParamsOp,
} from '@/ops';
import { registerPlugin } from '@/plugin-api';
import { createBuilderRegistry, createRegenerator } from '@/regen';
import { createViewport, type StandardView } from '@/render';

const VIEWS: readonly StandardView[] = ['iso', 'top', 'bottom', 'front', 'back', 'left', 'right'];
const MAX_EVENTS = 10;
const OVERLAY_ID = 'dev-sample';

// Branded ids by a cast: this page is the trusted place that invents them (as ops does in app).
const BOX_A = 'boxA' as FeatureId;
const BOX_B = 'boxB' as FeatureId;
const BOX_A_PARAMS: BoxParams = { origin: [0, 0, 0], width: 20, depth: 20, height: 20 };
// Next to A, with a gap, so the two never overlap.
const BOX_B_PARAMS: BoxParams = { origin: [30, 0, 0], width: 15, depth: 25, height: 10 };

function element(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

function inputElement(id: string): HTMLInputElement {
  const el = element(id);
  if (!(el instanceof HTMLInputElement)) throw new Error(`#${id} is not an input`);
  return el;
}

const framesEl = element('frames');
const memoryEl = element('memory');
const statusEl = element('status');
const eventsEl = element('events');
const pickEl = element('pick');
const viewsEl = element('views');
const heightEl = inputElement('height');
const overlayEl = inputElement('overlay');
const selectionEl = element('selection');

// Frame counter without a hook in the Viewport API: the viewport draws only from
// requestAnimationFrame callbacks (FrameScheduler), and nothing else on this page uses it. So
// wrapping the global before createViewport counts exactly the drawn frames.
let frames = 0;
const nativeRequestFrame = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (callback) =>
  nativeRequestFrame((time) => {
    frames += 1;
    framesEl.textContent = String(frames);
    callback(time);
  });

// Live GPU buffers without a hook in the Viewport API: the page counts WebGL buffers created and
// deleted through the WebGL2 context prototype (three defines WebGLRenderer.render on the
// instance, so wrapping the renderer prototype would never run). The count must not grow when the
// height changes again and again: every swap disposes the geometries of the removed BodyView.
let liveBuffers = 0;
const gl = WebGL2RenderingContext.prototype;
// eslint-disable-next-line @typescript-eslint/unbound-method -- called with the right `this` below
const nativeCreateBuffer = gl.createBuffer;
// eslint-disable-next-line @typescript-eslint/unbound-method -- called with the right `this` below
const nativeDeleteBuffer = gl.deleteBuffer;
function showBuffers(): void {
  memoryEl.textContent = `live WebGL buffers ${String(liveBuffers)}`;
}
gl.createBuffer = function createBuffer(this: WebGL2RenderingContext) {
  const buffer = nativeCreateBuffer.call(this);
  liveBuffers += 1;
  showBuffers();
  return buffer;
};
gl.deleteBuffer = function deleteBuffer(this: WebGL2RenderingContext, buffer: WebGLBuffer | null) {
  nativeDeleteBuffer.call(this, buffer);
  if (buffer !== null) liveBuffers -= 1;
  showBuffers();
};

function status(text: string): void {
  statusEl.textContent = text;
}

function aBox(id: FeatureId, name: string, params: BoxParams): FeatureInstance<BoxParams> {
  return { id, type: 'box', typeVersion: 1, name, params, suppressed: false };
}

async function run(): Promise<void> {
  status('Starting OCCT…');
  const kernel = await createOcctKernel();

  const schemas = createFeatureSchemaRegistry();
  const builders = createBuilderRegistry();
  registerPlugin(boxPlugin, { schemas, builders });

  const doc = createDocument({
    meta: { id: 'dev-viewport' as DocumentId, name: 'Viewport dev', createdAt: Date.now() },
  });
  const dispatcher = createOperationDispatcher({
    doc,
    handlers: createOpHandlerRegistry(),
    log: createOperationLog(),
  });
  const regenerator = createRegenerator({
    kernel,
    builders,
    schemas,
    now: () => performance.now(),
  });

  const viewport = createViewport({ meshes: kernel });
  viewport.mount(element('view'));
  setUpViewControls(viewport);
  setUpHighlight(viewport);
  setUpOverlay(viewport);

  let fitted = false;
  async function regenerate(): Promise<void> {
    const result = await regenerator.run(doc.studio);
    if (result === 'superseded') return;
    const errors = [...result.statuses].filter(([, s]) => s.kind === 'error');
    const bodies = [...result.finalState.bodies.values()].map(({ id, shape }) => ({ id, shape }));
    await viewport.bodies.sync(bodies);
    // The first result only: later changes keep the camera where the user left it.
    if (!fitted && bodies.length > 0) {
      fitted = true;
      viewport.camera.fitAll();
    }
    status(
      errors.length === 0
        ? `${String(bodies.length)} bodies, regenerated in ${result.durationMs.toFixed(1)} ms`
        : `Errors: ${errors.map(([id, s]) => `${id} ${JSON.stringify(s)}`).join('; ')}`,
    );
  }

  function regenerateLogged(): void {
    regenerate().catch((e: unknown) => {
      status(`Regeneration failed: ${String(e)}`);
      console.error(e);
    });
  }

  doc.events.on('changed', regenerateLogged);

  for (const [index, feature] of [
    aBox(BOX_A, 'Box A', BOX_A_PARAMS),
    aBox(BOX_B, 'Box B', BOX_B_PARAMS),
  ].entries()) {
    const op: FeatureAddOp = { type: 'feature.add', v: 1, feature, index };
    dispatcher.dispatch(op);
  }

  heightEl.value = String(BOX_A_PARAMS.height);
  heightEl.disabled = false;
  heightEl.addEventListener('input', () => {
    const height = heightEl.valueAsNumber;
    // An empty or half-typed field; the schema would reject it anyway.
    if (!Number.isFinite(height) || height <= 0) return;
    const op: FeatureSetParamsOp = {
      type: 'feature.setParams',
      v: 1,
      featureId: BOX_A,
      params: { ...BOX_A_PARAMS, height },
    };
    dispatcher.dispatch(op);
  });

  // Lets the console poke at it: `viewport.screenToRay(100, 100)`, `kernel.liveHandleCount()`.
  Object.assign(window, { viewport, kernel, doc, dispatcher });
}

function setUpViewControls(viewport: ReturnType<typeof createViewport>): void {
  function addButton(label: string, onClick: () => void): void {
    const button = document.createElement('button');
    button.textContent = label;
    button.addEventListener('click', onClick);
    viewsEl.appendChild(button);
  }

  for (const view of VIEWS) {
    addButton(view, () => {
      viewport.camera.setView(view);
    });
  }
  addButton('Fit', () => {
    viewport.camera.fitAll();
  });

  const lines: string[] = [];

  function log(line: string): void {
    lines.unshift(line);
    lines.length = Math.min(lines.length, MAX_EVENTS);
    eventsEl.textContent = lines.join('\n');
  }

  function mods({ mods: m }: ViewPointerEvent | ViewKeyEvent): string {
    return [m.shift ? 'shift' : '', m.alt ? 'alt' : '', m.mod ? 'mod' : '']
      .filter(Boolean)
      .join('+');
  }

  viewport.events.on('pointer', (e) => {
    if (e.type === 'move') pickEl.textContent = describePick(viewport.pick(e.x, e.y));
    if (e.type === 'leave') pickEl.textContent = '–';
    log(`pointer ${e.type.padEnd(5)} ${String(e.x)},${String(e.y)} ${e.button ?? '-'} ${mods(e)}`);
  });
  viewport.events.on('key', (e) => {
    log(`key     ${JSON.stringify(e.key)} ${mods(e)}`);
  });
}

/**
 * Hover follows pick under the cursor; a left click selects what is under it (Shift adds or
 * removes it), a left click on empty space clears the selection. Right and middle drive the
 * camera and do not select.
 */
function setUpHighlight(viewport: ReturnType<typeof createViewport>): void {
  let selection: readonly PickResult[] = [];

  function select(next: readonly PickResult[]): void {
    selection = next;
    viewport.highlight.setSelection(selection);
    selectionEl.textContent =
      selection.length === 0 ? '–' : selection.map((t) => describeTarget(t)).join('; ');
  }

  viewport.events.on('pointer', (e) => {
    if (e.type === 'leave') {
      viewport.highlight.setHover(null);
      return;
    }
    if (e.type === 'move') {
      viewport.highlight.setHover(viewport.pick(e.x, e.y));
      return;
    }
    if (e.type !== 'down' || e.button !== 'left') return;
    const hit = viewport.pick(e.x, e.y);
    if (!e.mods.shift) {
      select(hit === null ? [] : [hit]);
    } else if (hit !== null) {
      const selected = selection.some((t) => sameTarget(t, hit));
      select(selected ? selection.filter((t) => !sameTarget(t, hit)) : [...selection, hit]);
    }
  });
}

/** Sample overlay: X/Y/Z axes 0–30 mm as construction, a rectangle above box B as preview. */
function setUpOverlay(viewport: ReturnType<typeof createViewport>): void {
  const top = BOX_B_PARAMS.height + 5;
  const [x0, y0] = BOX_B_PARAMS.origin;
  const x1 = x0 + BOX_B_PARAMS.width;
  const y1 = y0 + BOX_B_PARAMS.depth;
  const shapes: readonly OverlayShape[] = [
    {
      kind: 'lines',
      style: 'construction',
      points: [
        [0, 0, 0],
        [30, 0, 0],
        [0, 0, 0],
        [0, 30, 0],
        [0, 0, 0],
        [0, 0, 30],
      ],
    },
    {
      kind: 'lines',
      style: 'preview',
      points: [
        [x0, y0, top],
        [x1, y0, top],
        [x1, y0, top],
        [x1, y1, top],
        [x1, y1, top],
        [x0, y1, top],
        [x0, y1, top],
        [x0, y0, top],
      ],
    },
    {
      kind: 'points',
      style: 'preview',
      points: [
        [x0, y0, top],
        [x1, y0, top],
        [x1, y1, top],
        [x0, y1, top],
      ],
    },
    { kind: 'points', style: 'construction', points: [[0, 0, 0]] },
  ];

  overlayEl.disabled = false;
  overlayEl.addEventListener('change', () => {
    if (overlayEl.checked) viewport.overlay.set(OVERLAY_ID, shapes);
    else viewport.overlay.remove(OVERLAY_ID);
  });
}

/** Same face or edge (kind, body, index); a copy of render's rule, which is internal. */
function sameTarget(a: PickResult, b: PickResult): boolean {
  if (a.kind === 'face' && b.kind === 'face')
    return a.body === b.body && a.faceIndex === b.faceIndex;
  if (a.kind === 'edge' && b.kind === 'edge')
    return a.body === b.body && a.edgeIndex === b.edgeIndex;
  return false;
}

function describeTarget(target: PickResult): string {
  return target.kind === 'face'
    ? `face ${target.body} #${String(target.faceIndex)}`
    : `edge ${target.body} #${String(target.edgeIndex)}`;
}

function describePick(result: PickResult | null): string {
  if (result === null) return 'null';
  const round = (v: readonly number[]) => v.map((c) => c.toFixed(2)).join(', ');
  return result.kind === 'face'
    ? `face ${result.body} #${String(result.faceIndex)} at (${round(result.point)}) n (${round(result.normal)})`
    : `edge ${result.body} #${String(result.edgeIndex)} at (${round(result.point)})`;
}

run().catch((e: unknown) => {
  status(`Error: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
  console.error(e);
});
