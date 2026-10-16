// ToolManager (spec 10, "Nástroje"): exactly one tool is active and gets the viewport
// events. Every activation gets its own ctx whose finish is bound to that activation,
// so a stale tool cannot switch tools any more. With a mode (M12) only the tools of the current
// mode can be active and each mode has its own default tool. Layers of input (M20, A4.3) come
// before the tool in their order; app composes them (manipulators → refPick → the active tool).

import { ObservableValue } from '@/core';
import type { Observable, RegistryReader, Subscribable, Unsubscribe } from '@/core';
import type { InputLayer } from './input-layer';
import { isPlainEscape } from './key-events';
import type { Mode } from './mode';
import { toolModes } from './constants';
import type { Tool, ToolContext, ToolDescriptor } from './tools';
import type { ViewKeyEvent, ViewPointerEvent, ViewportEvents } from './viewport-port';

export interface ToolManager {
  /** Id of the active tool. */
  readonly active: Observable<string>;
  /**
   * Deactivates the previous tool. An unknown id or a tool outside the current mode throws, the
   * active tool stays.
   */
  activate(id: string): void;
  /** Unsubscribes from the events, deactivates the active tool. */
  dispose(): void;
}

/** One activation of a tool. */
interface Activation {
  readonly id: string;
  readonly tool: Tool;
  /** finish() was called while tool.activate was still running. */
  finishRequested: boolean;
  activating: boolean;
}

export function createToolManager(deps: {
  registry: RegistryReader<ToolDescriptor>;
  ctx: Omit<ToolContext, 'finish'>;
  /** Pointer and key events of the viewport; the tools get them only through the manager. */
  viewportEvents: Subscribable<ViewportEvents>;
  /** The default tool of the mode 'model'. */
  defaultToolId: string;
  /** The current mode (M12); without it the mode is always 'model'. */
  mode?: Observable<Mode>;
  /** Default tools of the other modes; with `mode`, the one of 'sketch' must be registered. */
  defaultToolIds?: Partial<Record<Mode, string>>;
  /** Keys from the viewport the tool did not handle (app hooks ActionRegistry.handleKey here). */
  unhandledKey?: (e: ViewKeyEvent) => boolean;
  /**
   * Layers of input asked in this order before the active tool (M20, A4.3); without them the
   * tool gets every event.
   */
  layers?: readonly InputLayer[];
}): ToolManager {
  const { registry } = deps;
  const layers = deps.layers ?? [];
  const modeOf = (): Mode => deps.mode?.get() ?? 'model';

  /** The default tool of the mode; 'model' always has defaultToolId. */
  function defaultIdOf(mode: Mode): string {
    if (mode === 'model') return deps.defaultToolId;
    const id = deps.defaultToolIds?.[mode];
    if (id === undefined) throw new Error(`No default tool for the mode '${mode}'`);
    return id;
  }

  // Throws for an unknown default tool before anything is subscribed.
  registry.get(deps.defaultToolId);
  if (deps.mode !== undefined) registry.get(defaultIdOf('sketch'));

  /** The mode the active tool was started for; followed by onModeChanged. */
  let mode = modeOf();
  const defaultToolId = (): string => defaultIdOf(mode);

  const active = new ObservableValue<string>(defaultToolId());
  let current: Activation | null = null;
  let disposed = false;

  /**
   * Creates and activates the tool. A tool failing in create or activate is dropped
   * without deactivate, the default tool comes back and the error flies on. When the
   * default tool itself fails, no tool is active (events are dropped).
   */
  function start(id: string): void {
    const descriptor = registry.get(id);
    let activation: Activation;
    try {
      activation = activateTool(id, descriptor.create());
    } catch (error) {
      current = null;
      if (id !== defaultToolId()) restoreDefault(error);
      throw error;
    }
    // Outside the try: the tool is fine, only switching back to the default may fail.
    if (activation.finishRequested) finish(activation);
  }

  function activateTool(id: string, tool: Tool): Activation {
    const activation: Activation = { id, tool, finishRequested: false, activating: true };
    const ctx: ToolContext = Object.freeze({
      ...deps.ctx,
      finish: () => {
        finish(activation);
      },
    });
    current = activation;
    tool.activate(ctx);
    activation.activating = false;
    // activate may have switched the mode, which already replaced this tool by the default.
    if (current === activation) active.set(id);
    return activation;
  }

  /** After a failed tool; when the default fails too, both errors fly on. */
  function restoreDefault(cause: unknown): void {
    try {
      start(defaultToolId());
    } catch (error) {
      throw new AggregateError([cause, error], 'The tool and the default tool failed', {
        cause: error,
      });
    }
  }

  function finish(activation: Activation): void {
    if (activation !== current || activation.id === defaultToolId()) return;
    if (activation.activating) {
      // "Open a dialog and finish" tools: switch only after activate has returned.
      activation.finishRequested = true;
      return;
    }
    switchTo(defaultToolId());
  }

  function switchTo(id: string): void {
    // Throws for an unknown id before the active tool is touched.
    registry.get(id);
    if (current?.id === id) return;
    current?.tool.deactivate();
    current = null;
    start(id);
  }

  /**
   * left[i]: level i (layers[i], or the tool for i = layers.length) last got a leave. At the
   * start no level has got one yet.
   */
  const left: boolean[] = Array.from({ length: layers.length + 1 }, () => false);

  function onPointer(e: ViewPointerEvent): void {
    route(e, 0);
  }

  /** Hands the event to the levels from `from` down, until one handles it. */
  function route(e: ViewPointerEvent, from: number): void {
    for (let i = from; i < layers.length; i++) {
      const layer = layers[i];
      if (layer === undefined) continue;
      left[i] = e.type === 'leave';
      if (!layer.onPointer(e)) continue;
      // The layer took the move: no hover may stay under it in the levels below (spec 10).
      if (e.type === 'move' && layer.leaveBelow !== false && left[i + 1] !== true) {
        route({ ...e, type: 'leave' }, i + 1);
      }
      return;
    }
    left[layers.length] = e.type === 'leave';
    current?.tool.onPointer?.(e);
  }

  /** M32: a key handled by a layer, the tool or unhandledKey is consumed (Tab keeps the focus). */
  function onKey(e: ViewKeyEvent): void {
    if (handleKey(e)) e.consume?.();
  }

  /** True = a layer, the tool or unhandledKey handled the key. */
  function handleKey(e: ViewKeyEvent): boolean {
    if (layers.some((layer) => layer.onKey(e))) return true;
    const activation = current;
    if (activation === null) return false;
    if (activation.tool.onKey?.(e) === true) return true;
    if (isPlainEscape(e) && activation.id !== defaultToolId()) {
      switchTo(defaultToolId());
      return false;
    }
    return deps.unhandledKey?.(e) === true;
  }

  /** A new mode: the active tool gives way to the default tool of the mode. */
  function onModeChanged(): void {
    const next = modeOf();
    if (next === mode) return;
    mode = next;
    switchTo(defaultToolId());
  }

  // Start first: a failing default tool throws out of here with nothing subscribed.
  start(defaultToolId());
  const subscriptions: readonly Unsubscribe[] = [
    deps.viewportEvents.on('pointer', onPointer),
    deps.viewportEvents.on('key', onKey),
    ...(deps.mode === undefined ? [] : [deps.mode.subscribe(onModeChanged)]),
  ];

  return {
    active: active.asObservable(),
    activate(id) {
      if (disposed) throw new Error('ToolManager is disposed');
      // Throws for an unknown id first, then for a tool of another mode.
      if (!toolModes(registry.get(id)).includes(mode)) {
        throw new Error(`Tool '${id}' is not available in the mode '${mode}'`);
      }
      switchTo(id);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const unsubscribe of subscriptions) unsubscribe();
      const last = current;
      current = null;
      last?.tool.deactivate();
    },
  };
}
