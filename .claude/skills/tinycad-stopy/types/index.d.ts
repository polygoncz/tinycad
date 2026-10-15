/** The state of one milestone as a vault note says it. */
export type MilestoneState = 'todo' | 'doing' | 'done';

/** How a milestone stands for the panel. */
export type MilestoneKind = 'inMain' | 'doneInBranch' | 'running' | 'waiting';

export type MilestoneRow = {
  /** "M25". */
  id: string;
  /** "Glyfy vazeb". */
  title: string;
  kind: MilestoneKind;
  /** Ticked and all tasks of the Úkoly section. */
  done: number;
  total: number;
  /** Ids of milestones it waits for (not done in main). */
  waitsFor: string[];
};

export type TrackRow = {
  /** "stopa-a-m25-m27". */
  name: string;
  branch: string;
  /** Commits on the branch not in main. */
  ahead: number;
  /** Changed or new files in its worktree. */
  dirty: number;
  milestones: MilestoneRow[];
};

export type Snapshot = {
  tracks: TrackRow[];
  /** Milestones in progress on main itself. */
  main: MilestoneRow[];
  /** Milestones on main waiting for another one. */
  waiting: MilestoneRow[];
  /** Last merge commits on main, newest first: "ea9376a Merge track C…". */
  merges: string[];
  /** "19:42:05". */
  updatedAt: string;
  error: string | null;
};

declare module 'claude-code' {
  interface PluginState {
    'tinycad-stopy': { snapshot: Snapshot | null }
  }
}
