import { describe, expect, test } from 'claude-code/testing'

import { byId, mainMilestones, parseMilestone, parseWorktrees, trackMilestones, trackName } from './model'
import type { Milestone } from './model'

const note = (status: string, tasks: string, deps: string[] = []): string =>
  [
    '---',
    'type: milestone',
    `status: ${status}`,
    'aliases:',
    '  - M26',
    '  - M26 Snapper',
    'depends_on:',
    ...deps.map(d => `  - "[[${d}]]"`),
    'started:',
    '---',
    '# M26 – Snapper a automatické vazby',
    '',
    '## Úkoly',
    '',
    tasks,
    '',
    '## Akceptační kritéria',
    '- [ ] not a task',
  ].join('\n')

const ms = (file: string, status: Milestone['status'], done = 0, total = 0, dependsOn: string[] = []): Milestone => ({
  id: file.split('-')[0] ?? file,
  file,
  title: file,
  status,
  done,
  total,
  dependsOn,
})

describe('parseMilestone', () => {
  test('reads id, title, status, tasks of the Úkoly section only and depends_on', async () => {
    const m = parseMilestone(
      'M26-snapper-a-auto-vazby',
      note('doing', '- [x] 0. a\n- [ ] 1. b\n- [ ] 2. c', ['M25-glyfy-vazeb']),
    )
    expect(m).toEqual({
      id: 'M26',
      file: 'M26-snapper-a-auto-vazby',
      title: 'Snapper a automatické vazby',
      status: 'doing',
      done: 1,
      total: 3,
      dependsOn: ['M25-glyfy-vazeb'],
    })
  })

  test('a note that is not a milestone is null', async () => {
    expect(parseMilestone('Roadmapa', '---\ntype: moc\n---\n# Roadmapa')).toBe(null)
  })
})

describe('git', () => {
  test('parseWorktrees reads paths and branches, main first', async () => {
    const out = parseWorktrees(
      'worktree /r\nHEAD abc\nbranch refs/heads/main\n\nworktree /r/.claude/worktrees/x\nHEAD def\nbranch refs/heads/claude/stopa-b-m28-d225e5\n\n',
    )
    expect(out).toEqual([
      { path: '/r', branch: 'main' },
      { path: '/r/.claude/worktrees/x', branch: 'claude/stopa-b-m28-d225e5' },
    ])
    expect(trackName('claude/stopa-b-m28-d225e5')).toBe('stopa-b-m28')
  })
})

describe('kinds', () => {
  test('a track shows what moved from main: done there = done in branch, else running', async () => {
    const main = new Map(
      [ms('M25-a', 'todo', 1, 5), ms('M26-b', 'todo', 0, 5), ms('M27-c', 'todo', 0, 3)].map(m => [m.file, m]),
    )
    const rows = trackMilestones([ms('M25-a', 'done', 5, 5), ms('M26-b', 'doing', 1, 6), ms('M27-c', 'todo', 0, 3)], main)
    expect(rows.map(r => [r.id, r.kind, r.done, r.total])).toEqual([
      ['M25', 'doneInBranch', 5, 5],
      ['M26', 'running', 1, 6],
    ])
  })

  test('main: doing milestones, and todo ones waiting for an unfinished dependency', async () => {
    const { doing, waiting } = mainMilestones([
      ms('M24-x', 'done'),
      ms('M26-b', 'todo', 0, 0, ['M24-x']),
      ms('M27-c', 'todo', 0, 0, ['M26-b']),
      ms('M29-s', 'doing', 7, 9, ['M24-x']),
    ])
    expect(doing.map(r => r.id)).toEqual(['M29'])
    expect(waiting.map(r => [r.id, r.waitsFor])).toEqual([['M27', ['M26']]])
  })

  test('byId sorts numerically', async () => {
    expect([{ id: 'M10.1' }, { id: 'M9' }, { id: 'M10' }].sort(byId).map(x => x.id)).toEqual(['M9', 'M10', 'M10.1'])
  })
})
