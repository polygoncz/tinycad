// Pure parsing for the panel: git porcelain output and milestone notes of the tinycad vault.
// No engine calls here, so the tests run it directly.

import type { MilestoneRow, MilestoneState } from '../types'

/** One milestone note as read from docs/40-plan/Mnn-*.md. */
export type Milestone = {
  /** "M25" (from the first alias, else the file name). */
  id: string
  /** "M25-glyfy-vazeb", what wikilinks name. */
  file: string
  title: string
  status: MilestoneState
  done: number
  total: number
  /** File names from depends_on wikilinks. */
  dependsOn: string[]
}

export type Worktree = { path: string; branch: string }

/** `git worktree list --porcelain` → the worktrees; the first is the main checkout. */
export function parseWorktrees(porcelain: string): Worktree[] {
  const out: Worktree[] = []
  let path: string | null = null
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) path = line.slice('worktree '.length)
    else if (line.startsWith('branch ') && path !== null) {
      out.push({ path, branch: line.slice('branch '.length).replace(/^refs\/heads\//, '') })
      path = null
    } else if (line === '' && path !== null) {
      out.push({ path, branch: '(detached)' })
      path = null
    }
  }
  if (path !== null) out.push({ path, branch: '(detached)' })
  return out
}

/** "claude/stopa-a-m25-m27-f7ea83" → "stopa-a-m25-m27". */
export function trackName(branch: string): string {
  return branch.replace(/^claude\//, '').replace(/-[0-9a-f]{6}$/, '')
}

/** A milestone note, or null when the text is not one (no type: milestone). */
export function parseMilestone(file: string, text: string): Milestone | null {
  const fm = /^---\n([\s\S]*?)\n---/.exec(text)
  if (fm === null) return null
  const front = fm[1] ?? ''
  if (!/^type:\s*milestone\s*$/m.test(front)) return null
  const statusMatch = /^status:\s*(todo|doing|done)\s*$/m.exec(front)
  const status: MilestoneState = (statusMatch?.[1] as MilestoneState | undefined) ?? 'todo'
  const alias = /^aliases:\s*\n\s+-\s*(M[\d.]+)\s*$/m.exec(front)?.[1]
  const id = alias ?? /^(M[\d.]+)/.exec(file)?.[1] ?? file
  const heading = /^#\s+M[\d.]+\s+[–-]\s+(.+)$/m.exec(text)?.[1]?.trim() ?? file
  const dependsOn = listProperty(front, 'depends_on')
    .map(v => /\[\[([^\]|#]+)/.exec(v)?.[1])
    .filter((v): v is string => v !== undefined)
  const tasks = section(text, 'Úkoly')
  const done = (tasks.match(/^- \[x\]/gim) ?? []).length
  const total = done + (tasks.match(/^- \[ \]/gm) ?? []).length
  return { id, file, title: heading, status, done, total, dependsOn }
}

/** The items of a YAML list property (`key:` then `  - item` lines). */
function listProperty(front: string, key: string): string[] {
  const lines = front.split('\n')
  const start = lines.findIndex(l => l.startsWith(`${key}:`))
  if (start < 0) return []
  const items: string[] = []
  for (const line of lines.slice(start + 1)) {
    const item = /^\s+-\s*(.+)$/.exec(line)
    if (item === null) break
    items.push(item[1] ?? '')
  }
  return items
}

/** The text of a `## name` section up to the next `## `. */
function section(text: string, name: string): string {
  const start = text.indexOf(`\n## ${name}\n`)
  if (start < 0) return ''
  const rest = text.slice(start + name.length + 5)
  const end = rest.indexOf('\n## ')
  return end < 0 ? rest : rest.slice(0, end)
}

/** Ids of the dependencies of `m` not done in main, by file name. */
export function waitsFor(m: Milestone, mainByFile: ReadonlyMap<string, Milestone>): string[] {
  return m.dependsOn
    .map(f => mainByFile.get(f))
    .filter((d): d is Milestone => d !== undefined && d.status !== 'done')
    .map(d => d.id)
}

/**
 * The milestones a track worktree has moved on from main: a status or a task count that differs.
 * Done there = done in the branch; anything else = running.
 */
export function trackMilestones(
  branch: readonly Milestone[],
  mainByFile: ReadonlyMap<string, Milestone>,
): MilestoneRow[] {
  return branch
    .filter(m => {
      const inMain = mainByFile.get(m.file)
      return (
        inMain === undefined ||
        (inMain.status !== 'done' &&
          (inMain.status !== m.status || inMain.done !== m.done || inMain.total !== m.total))
      )
    })
    .map(m => row(m, m.status === 'done' ? 'doneInBranch' : 'running', []))
}

/** Milestones in progress on main, and the todo ones that wait for an unfinished one. */
export function mainMilestones(main: readonly Milestone[]): {
  doing: MilestoneRow[]
  waiting: MilestoneRow[]
} {
  const byFile = new Map(main.map(m => [m.file, m]))
  const doing = main.filter(m => m.status === 'doing').map(m => row(m, 'inMain', []))
  const waiting = main
    .filter(m => m.status === 'todo')
    .map(m => ({ m, waits: waitsFor(m, byFile) }))
    .filter(({ waits }) => waits.length > 0)
    .map(({ m, waits }) => row(m, 'waiting', waits))
  return { doing, waiting }
}

function row(m: Milestone, kind: MilestoneRow['kind'], waits: string[]): MilestoneRow {
  return { id: m.id, title: m.title, kind, done: m.done, total: m.total, waitsFor: waits }
}

/** Sorts milestone ids numerically: M9 < M10 < M10.1. */
export function byId(a: { id: string }, b: { id: string }): number {
  const num = (s: string): number => Number.parseFloat(s.replace(/^M/, '')) || 0
  return num(a.id) - num(b.id)
}
