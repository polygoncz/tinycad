// ToolManager (spec 10, "Nástroje"): exactly one tool is active and gets the viewport
// events. Every activation gets its own ctx whose finish is bound to that activation,
// so a stale tool cannot switch tools any more. While the dialog has a focused
// reference param, the inner refPick covers the active tool (Q066).

import { ObservableValue } from '@/core';
import type { Observable, RegistryReader, Unsubscribe } from '@/core';
import type { FeatureEditSession } from './feature-editor';
import { isPlainEscape } from './key-events';
import { createRefPick } from './ref-pick-tool';
import type { RefPick } from './ref-pick-tool';
import type { Tool, ToolContext, ToolDescriptor } from './tools';
import type { ViewKeyEvent, ViewPointerEvent } from './viewport-port';

export interface ToolManager {
  /** Id of the active tool. */
  readonly active: Observable<string>;
  /** Deactivates the previous tool. Unknown id throws, the active tool stays. */
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
  defaultToolId: string;
  /** Keys from the viewport the tool did not handle (app hooks ActionRegistry.handleKey here). */
  unhandledKey?: (e: ViewKeyEvent) => boolean;
}): ToolManager {
  const { registry, defaultToolId } = deps;
  // Throws for an unknown default tool before anything is subscribed.
  registry.get(defaultToolId);

  const active = new ObservableValue<string>(defaultToolId);
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
      if (id !== defaultToolId) restoreDefault(error);
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
    active.set(id);
    return activation;
  }

  /** After a failed tool; when the default fails too, both errors fly on. */
  function restoreDefault(cause: unknown): void {
    try {
      start(defaultToolId);
    } catch (error) {
      throw new AggregateError([cause, error], 'The tool and the default tool failed', {
        cause: error,
      });
    }
  }

  function finish(activation: Activation): void {
    if (activation !== current || activation.id === defaultToolId) return;
    if (activation.activating) {
      // "Open a dialog and finish" tools: switch only after activate has returned.
      activation.finishRequested = true;
      return;
    }
    switchTo(defaultToolId);
  }

  function switchTo(id: string): void {
    // Throws for an unknown id before the active tool is touched.
    registry.get(id);
    if (current?.id === id) return;
    current?.tool.deactivate();
    current = null;
    start(id);
  }

  // --- refPick: follows editor.current and the state of its session ---

  let session: FeatureEditSession | null = null;
  let unsubscribeSession: Unsubscribe | null = null;
  let refPick: RefPick | null = null;

  /** Creates or drops refPick by the focused reference param of the current session. */
  /** The focused param of the current session; the hover is cleared when it changes. */
  let refParam: string | null = null;

  function syncRefPick(): void {
    const next = session?.state.get().activeRefParam ?? null;
    if (session === null || next === null) {
      dropRefPick();
      refParam = null;
      return;
    }
    refPick ??= createRefPick(session, deps.ctx.viewport);
    // Another param may allow other targets: the old hover must not stay (spec 10).
    if (refParam !== null && refParam !== next) deps.ctx.viewport.highlight.setHover(null);
    refParam = next;
  }

  function dropRefPick(): void {
    const last = refPick;
    refPick = null;
    last?.dispose();
  }

  function onSessionChanged(): void {
    const next = deps.ctx.features.current.get();
    if (next === session) return;
    unsubscribeSession?.();
    unsubscribeSession = null;
    // refPick belongs to the old session.
    dropRefPick();
    session = next;
    if (next !== null) unsubscribeSession = next.state.subscribe(syncRefPick);
    syncRefPick();
  }

  function onPointer(e: ViewPointerEvent): void {
    if (refPick !== null) {
      refPick.onPointer(e);
      return;
    }
    current?.tool.onPointer?.(e);
  }

  function onKey(e: ViewKeyEvent): void {
    if (refPick !== null) {
      if (!refPick.onKey(e)) deps.unhandledKey?.(e);
      return;
    }
    const activation = current;
    if (activation === null) return;
    if (activation.tool.onKey?.(e) === true) return;
    if (isPlainEscape(e) && activation.id !== defaultToolId) {
      switchTo(defaultToolId);
      return;
    }
    deps.unhandledKey?.(e);
  }

  // Start first: a failing default tool throws out of here with nothing subscribed.
  start(defaultToolId);
  const subscriptions: readonly Unsubscribe[] = [
    deps.ctx.viewport.events.on('pointer', onPointer),
    deps.ctx.viewport.events.on('key', onKey),
    deps.ctx.features.current.subscribe(onSessionChanged),
  ];
  onSessionChanged();

  return {
    active: active.asObservable(),
    activate(id) {
      if (disposed) throw new Error('ToolManager is disposed');
      switchTo(id);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const unsubscribe of subscriptions) unsubscribe();
      unsubscribeSession?.();
      unsubscribeSession = null;
      session = null;
      dropRefPick();
      const last = current;
      current = null;
      last?.tool.deactivate();
    },
  };
}
