// The shape of a session as ui sees it (spec 11, "Kompoziční kořen (app)"): AppSession, the 3D
// view it needs (AppViewport) and the states it shows. createRemoteAppSession builds it over the
// native core (N68); the types moved here unchanged from the local session of the browser (M47).

import type { Disposable, Observable, Unsubscribe, Vec3 } from '@/core';
import type { BodyId, BodyMaterial, DocumentMeta, DocumentReader } from '@/document';
import type {
  ActionRegistry,
  BrowserModel,
  DocumentNameModel,
  FeatureEditor,
  FeatureTreeModel,
  FileActions,
  HistoryModel,
  ManipulatorHud,
  Mode,
  SelectionModel,
  ToolbarModel,
  ToolHint,
  TopoInspector,
  ViewportPort,
} from '@/interaction';
import type { PluginMessages } from '@/plugin-api';
import type { BodyLayer, CameraController, Viewport } from '@/render';
import type { SketchEditor } from '@/sketcher';
import type { ViewportSettings, ViewSettings } from './view-settings';

/** The state of the core for the title bar (N69: the connection mapped onto it). */
export type KernelUiState = 'starting' | 'ready' | 'restarting' | 'failed' | 'unavailable';

/**
 * Whether the changes are saved (N69: the changes in flight mapped onto it). 'error': a write
 * failed and is retried. 'failed': repeating it cannot help, nothing is written until the end of
 * the session.
 */
export type PersistenceStatus = 'saved' | 'pending' | 'error' | 'failed';

export type RegenUiState = {
  /** A regeneration is running or due. */
  readonly busy: boolean;
  /** Bodies of the last finished regeneration. */
  readonly bodyCount: number;
  /** Duration of the last finished regeneration; null before the first. */
  readonly lastMs: number | null;
  /**
   * M19.1: text of the error of the last regeneration that threw (a bug, not a lost kernel);
   * null before the first such error and after a successful regeneration.
   */
  readonly failed: string | null;
};

/** M15: a file to download; ui implements the port (a Blob and <a download>). */
export interface DownloadFile {
  readonly name: string;
  readonly mime: string;
  readonly data: string | Uint8Array<ArrayBuffer>;
}

/** A stored document in the list of documents. */
export interface DocumentInfo {
  readonly meta: DocumentMeta;
  /** Highest stored seq, 0 = no entries. */
  readonly lastSeq: number;
  /** ms since epoch, the last write to the document. */
  readonly updatedAt: number;
}

/**
 * What app needs from the 3D view: the port of interaction plus mounting, the body layer, the
 * camera, the view settings (palette, view cube labels, rotation mode), body visibility and body
 * colour (M15). render's Viewport is one; tests
 * use a fake.
 * app hands the kernel to the view through `bodies.reset` whenever a kernel becomes ready
 * (spec 09, "Výměna instance jádra"), so the meshes the view was created with are replaced
 * before the first sync.
 */
export interface AppViewport extends ViewportPort, ViewportSettings {
  mount(el: HTMLElement): void;
  readonly bodies: BodyLayer;
  /**
   * M21: the pickable bodies and the preview of the edited feature's result in one swap
   * (ADR 0025, D3 of M19.1).
   */
  readonly syncLayers: Viewport['syncLayers'];
  readonly camera: CameraController;
  setBodyVisible(body: BodyId, visible: boolean): void;
  /** '#rrggbb', null = the face colour of the palette (spec 09, M15). */
  setBodyColor(body: BodyId, color: string | null): void;
  /** M24: the material preset of a body, shown in Realistic only (spec 09). */
  setBodyMaterial(body: BodyId, material: BodyMaterial): void;
  /** M19.2: the step of the drawn sketch grid in mm; the sketcher snaps to it (D4). */
  sketchGridStep(): number;
}

export interface AppSession extends Disposable {
  readonly doc: DocumentReader;
  /** Q038: the document is open in another tab. */
  readonly readOnly: boolean;
  /** Read-only or an open feature dialog: the one rule, from interaction (createEditLock). */
  readonly locked: Observable<boolean>;
  readonly regen: Observable<RegenUiState>;
  /** Q055: restart after a kernel crash. */
  readonly kernel: Observable<KernelUiState>;
  /**
   * Why the kernel did not start ('unavailable') or its last crash ('failed'), for the UI; null
   * otherwise.
   */
  readonly kernelError: Observable<string | null>;
  /**
   * M19.1: from 'failed' or 'unavailable' starts the kernel again, with an empty restart window;
   * in any other state it does nothing.
   */
  retryKernel(): void;
  /** Always 'saved' when read-only. */
  readonly persistence: Observable<PersistenceStatus>;
  /**
   * M19.1: the text of the last failed write while `persistence` is 'error' or 'failed', for the
   * UI; null otherwise and when read-only.
   */
  readonly persistenceError: Observable<string | null>;
  readonly selection: SelectionModel;
  /** Timeline. */
  readonly featureTree: FeatureTreeModel;
  /** Browser, visibility of bodies (Q071). */
  readonly browser: BrowserModel;
  /**
   * M20: the groups of the Toolbar and what its buttons do. Without dispose: the session
   * disposes it (ADR 0011).
   */
  readonly toolbar: Omit<ToolbarModel, 'dispose'>;
  readonly features: FeatureEditor;
  /** M20: what ui does with the actions: list them, run one, hand it a key. */
  readonly actions: Pick<ActionRegistry, 'actions' | 'run' | 'handleKey'>;
  /** Dictionaries of the plugins for vue-i18n (ADR 0014). */
  readonly messages: PluginMessages;
  /**
   * M12: the sketcher (sketch panel, mode). Without gridStep (M19.2): the step of the grid is
   * the viewport's, only the sketch tools read it.
   */
  readonly sketches: Omit<SketchEditor, 'gridStep'>;
  /** M12: = sketches.mode; the Toolbar and the dialog vs. the sketch panel follow it. */
  readonly mode: Observable<Mode>;
  /**
   * M14: the name of the face or edge under the cursor, for the debug panel (R111). Without
   * dispose: the inspector belongs to the session, which disposes it (ADR 0011).
   */
  readonly topoInspector: Omit<TopoInspector, 'dispose'>;
  /** M15: the edit history panel. Without dispose: the session disposes it (ADR 0011). */
  readonly history: Omit<HistoryModel, 'dispose'>;
  /**
   * M15: the state of an export; the actions themselves are in `actions`, group 'file'. Without
   * dispose: the session disposes it (ADR 0011).
   */
  readonly files: Omit<FileActions, 'dispose'>;
  /** M15: '#rrggbb' face colour of the current palette (viewSettings.setTheme), for the colour field in ui. */
  readonly defaultBodyColor: Observable<string>;
  /**
   * M19.2: the name of the document in the title bar and its rename (document.rename, outside
   * undo). Without dispose: the session disposes it (ADR 0011).
   */
  readonly documentName: Omit<DocumentNameModel, 'dispose'>;
  /**
   * M19: the HUD of the manipulator (mode bar and value field, spec 11 rule 8). hud, setMode and
   * setValue are the controller's; project and onViewChanged are forwarded from the viewport, so
   * ui can place the HUD over the view without knowing render.
   */
  readonly manipulator: {
    readonly hud: Observable<ManipulatorHud | null>;
    setMode(id: string): void;
    setValue(handleId: string, shown: number): void;
    /** Px relative to the view area; null when the view is not mounted. */
    project(world: Vec3): readonly [x: number, y: number] | null;
    /** The view moved (camera, resize): positions of the HUD are stale; every frame of an animation. */
    onViewChanged(listener: () => void): Unsubscribe;
  };
  /** M37: the tools as ui sees them: the hint HUD of the active tool (spec 11, rule 8a). */
  readonly tools: {
    /** The hint of the active tool's current step; null = none. */
    readonly hint: Observable<ToolHint | null>;
  };
  /**
   * M19.2: projection of world points onto the view and its moves, forwarded from the viewport
   * like manipulator.project and onViewChanged, for everything ui places over the view (the
   * dimensions of a sketch, D4).
   */
  readonly view: {
    /** Px relative to the view area; null when the view is not mounted. */
    project(world: Vec3): readonly [x: number, y: number] | null;
    /** The view moved (camera, resize): every frame of an animation. */
    onViewChanged(listener: () => void): Unsubscribe;
  };

  mountViewport(el: HTMLElement): void;
  /** D7 of M20: theme, view cube labels and rotation mode from ui (one port, see ViewSettings). */
  readonly viewSettings: ViewSettings;
  /**
   * Writes the pending queue of the persistence now, without the delay; read-only: nothing.
   * openAppSession calls it on pagehide and visibilitychange to hidden (Q034).
   */
  flush(): Promise<void>;
  /**
   * Writes the pending queue of the persistence (flush), then releases like dispose. Rejects
   * with the error of the flush, after releasing anyway. A second call returns the same promise.
   */
  close(): Promise<void>;
  /** Synchronous safety net: releases at once, the final save runs without being awaited. */
  dispose(): void;
}
