import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { MilestoneRow, Snapshot, TrackRow } from '../types'
import {
  byId,
  mainMilestones,
  parseMilestone,
  parseWorktrees,
  trackMilestones,
  trackName,
} from './model'
import type { Milestone } from './model'

const PANE = 'tinycad-stopy'
const TITLE = 'Stopy'
const PLAN_DIR = 'docs/40-plan'
const REFRESH_MS = 60_000

const snapshot = atom({ plugin: 'tinycad-stopy', key: 'snapshot' } as const, null)

type $ = EngineInterface

async function git($: $, cwd: string, args: string[]): Promise<string> {
  const r = await $.process.run(['git', ...args], { cwd, timeoutMs: 10_000 })
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.trim()}`)
  return r.stdout
}

async function milestonesIn($: $, root: string): Promise<Milestone[]> {
  const dir = `${root}/${PLAN_DIR}`
  if (!(await $.fs.exists(dir))) return []
  const entries = await $.fs.list(dir)
  const notes = entries.filter(e => e.kind === 'file' && /^M[\d.]+-.+\.md$/.test(e.name))
  const read = await Promise.all(
    notes.map(async e => parseMilestone(e.name.replace(/\.md$/, ''), await $.fs.read(`${dir}/${e.name}`))),
  )
  return read.filter((m): m is Milestone => m !== null)
}

function now(): string {
  const d = new Date()
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}

async function collect($: $): Promise<Snapshot> {
  const top = (await git($, '.', ['rev-parse', '--show-toplevel'])).trim()
  const worktrees = parseWorktrees(await git($, top, ['worktree', 'list', '--porcelain']))
  const mainTree = worktrees[0] ?? { path: top, branch: 'main' }
  const main = await milestonesIn($, mainTree.path)
  const mainByFile = new Map(main.map(m => [m.file, m]))

  const tracks: TrackRow[] = []
  for (const wt of worktrees.slice(1)) {
    const [ahead, status, ms] = await Promise.all([
      git($, wt.path, ['rev-list', '--count', `${mainTree.branch}..HEAD`]),
      git($, wt.path, ['status', '--porcelain']),
      milestonesIn($, wt.path),
    ])
    tracks.push({
      name: trackName(wt.branch),
      branch: wt.branch,
      ahead: Number.parseInt(ahead.trim(), 10) || 0,
      dirty: status.split('\n').filter(l => l.trim() !== '').length,
      milestones: trackMilestones(ms, mainByFile).sort(byId),
    })
  }

  const inTracks = new Set(tracks.flatMap(t => t.milestones.map(m => m.id)))
  const { doing, waiting } = mainMilestones(main)
  const merges = (await git($, mainTree.path, ['log', '--merges', '--oneline', '-5', mainTree.branch]))
    .split('\n')
    .filter(l => l.trim() !== '')
  return {
    tracks: tracks.filter(t => t.milestones.length > 0 || t.ahead > 0 || t.dirty > 0),
    main: doing.filter(m => !inTracks.has(m.id)).sort(byId),
    waiting: waiting.filter(m => !inTracks.has(m.id)).sort(byId),
    merges,
    updatedAt: now(),
    error: null,
  }
}

async function refresh($: $): Promise<void> {
  try {
    const next = await collect($)
    await update($, snapshot, () => next)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await update($, snapshot, prev => ({
      ...(prev ?? { tracks: [], main: [], waiting: [], merges: [] }),
      updatedAt: now(),
      error: message,
    }))
  }
}

const KIND_TEXT: Record<MilestoneRow['kind'], string> = {
  inMain: 'v main',
  doneInBranch: 'hotovo ve větvi',
  running: 'běží',
  waiting: 'čeká',
}
const KIND_COLOR: Record<MilestoneRow['kind'], string> = {
  inMain: 'success',
  doneInBranch: 'merged',
  running: 'warning',
  waiting: 'inactive',
}

function progress(m: MilestoneRow): string {
  const tasks = m.total > 0 ? ` ${String(m.done)}/${String(m.total)}` : ''
  const waits = m.waitsFor.length > 0 ? ` na ${m.waitsFor.join(', ')}` : ''
  return `${KIND_TEXT[m.kind]}${tasks}${waits}`
}

export const register: Register = on => {
  let timer: { cancel(): void } | null = null

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'stopy',
      description: 'Panel se stavem souběžných stop tinycad (worktree a milníky)',
    })
    timer?.cancel()
    timer = $.clock.every(REFRESH_MS, () => {
      void refresh($)
    })
    void refresh($)
    return next(e)
  })

  on('command.run', { command: 'stopy' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Panel Stopy otevřen.' }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    void refresh($)
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const snap = await read($, snapshot)
    const reload = (): void => {
      void refresh($)
    }

    const milestone = (m: MilestoneRow) => (
      <Box key={m.id} flexDirection="row" gap={1}>
        <Text color={KIND_COLOR[m.kind]}>●</Text>
        <Text weight="medium">{m.id}</Text>
        <Text>{m.title}</Text>
        <Text dimColor>{progress(m)}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Button key="reload" onPress={reload} dimColor>
            Obnovit
          </Button>
          <Text dimColor>{snap === null ? 'načítám…' : `stav v ${snap.updatedAt}`}</Text>
        </Box>
        {snap?.error != null && <Text color="error">{snap.error}</Text>}
        {snap?.tracks.map(t => (
          <Box key={t.branch} flexDirection="column">
            <Text weight="semibold">{t.name}</Text>
            <Text dimColor>
              {t.branch} · +{String(t.ahead)} commitů · {String(t.dirty)} změněných souborů
            </Text>
            {t.milestones.length === 0 && <Text dimColor>bez změny milníků</Text>}
            {t.milestones.map(milestone)}
          </Box>
        ))}
        {snap !== null && snap.main.length > 0 && (
          <Box flexDirection="column">
            <Text weight="semibold">main – rozpracované</Text>
            {snap.main.map(milestone)}
          </Box>
        )}
        {snap !== null && snap.waiting.length > 0 && (
          <Box flexDirection="column">
            <Text weight="semibold">Čeká</Text>
            {snap.waiting.map(milestone)}
          </Box>
        )}
        {snap !== null && snap.merges.length > 0 && (
          <Box flexDirection="column">
            <Text weight="semibold">Poslední sloučení do main</Text>
            {snap.merges.map(line => (
              <Text key={line} dimColor>
                {line}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
