/**
 * 대기 회의 없이 남은 지역 구간을 서버 회의로 입양한다, 가드
 *
 * 실측 2026-10-26: 녹음 중에 회의가 건너가 대기 회의가 지워졌고, 그 뒤 쌓인 구간 6개가
 * `local_…` 밑에 주인 없이 남았다. 건네기는 대기 회의만 보므로 영영 안 올라갔다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adoptOrphanParts, type AdoptDeps, type OrphanPart } from './adopt-orphans.ts'

const LOCAL = 'local_3453c20e-8bae-4c10-bb9b-caa74fa5012a'
const FIRST_SAVED = Date.parse('2026-10-26T01:57:41Z')

/** 사용자 실측 모양, 601초 다섯 개와 460초 하나 */
function userParts(noteId = LOCAL): OrphanPart[] {
  const durations = [601, 601, 601, 601, 601, 460]
  let at = FIRST_SAVED
  return durations.map((durationSec, partIdx) => {
    const row = { noteId, partIdx, durationSec, savedAt: at }
    at += (durations[partIdx + 1] ?? 0) * 1000
    return row
  })
}

function harness(parts: OrphanPart[], over: Partial<AdoptDeps> = {}) {
  const created: { now: Date }[] = []
  const rekeyed: [string, string][] = []
  const remembered: [string, string][] = []
  const pairs = new Map<string, string>()
  return {
    created, rekeyed, remembered, pairs,
    deps: {
      listParts: async () => parts,
      pendingLocalIds: () => [] as string[],
      activeNoteIds: [] as (string | null)[],
      leased: () => [] as string[],
      serverIdFor: (id: string) => pairs.get(id) ?? null,
      create: async (input: { now: Date }) => { created.push(input); return { id: 'm', noteId: 'note_adopted' } },
      remember: (l: string, n: string) => { remembered.push([l, n]); pairs.set(l, n) },
      rekey: async (from: string, to: string) => { rekeyed.push([from, to]); return parts.filter((p) => p.noteId === from).length },
      isOnline: () => true,
      withLock: async <T,>(fn: () => Promise<T>) => fn(),
      ...over,
    } satisfies AdoptDeps,
  }
}

test('★ 사용자 실측 모양: 회의 하나를 녹음 시작 시각으로 만들고 구간 6개를 옮긴다', async () => {
  const h = harness(userParts())
  const r = await adoptOrphanParts(h.deps)
  assert.equal(h.created.length, 1)
  assert.equal(h.created[0].now.toISOString(), '2026-10-26T01:47:40.000Z')
  assert.deepEqual(h.remembered, [[LOCAL, 'note_adopted']])
  assert.deepEqual(h.rekeyed, [[LOCAL, 'note_adopted']])
  assert.equal(r.adopted, 1)
  assert.equal(r.parts, 6)
})

test('★ 짝이 있으면 회의를 만들지 않고 그 서버 id 로 옮긴다', async () => {
  const h = harness(userParts())
  h.pairs.set(LOCAL, 'note_prev')
  await adoptOrphanParts(h.deps)
  assert.equal(h.created.length, 0)
  assert.deepEqual(h.rekeyed, [[LOCAL, 'note_prev']])
})

test('★ 녹음 임대가 살아 있거나 이 탭이 녹음 중인 지역 id 는 건드리지 않는다', async () => {
  const leased = harness(userParts(), { leased: () => [LOCAL] })
  await adoptOrphanParts(leased.deps)
  assert.equal(leased.created.length, 0)
  assert.deepEqual(leased.rekeyed, [])
  const active = harness(userParts(), { activeNoteIds: [null, LOCAL] })
  await adoptOrphanParts(active.deps)
  assert.deepEqual(active.rekeyed, [])
})

test('★ 대기 회의가 있는 지역 id 는 건네기 몫이라 건드리지 않는다', async () => {
  const h = harness(userParts(), { pendingLocalIds: () => [LOCAL] })
  await adoptOrphanParts(h.deps)
  assert.equal(h.created.length, 0)
  assert.deepEqual(h.rekeyed, [])
})

test('★ 두 번 돌려도 회의는 하나다 (멱등)', async () => {
  let fail = true
  const h = harness(userParts(), {
    rekey: async () => { if (fail) { fail = false; throw new Error('옮기지 못했어요') } return 6 },
  })
  const first = await adoptOrphanParts(h.deps)
  assert.equal(first.failed.length, 1)
  await adoptOrphanParts(h.deps)
  assert.equal(h.created.length, 1, '같은 녹음으로 회의를 두 번 만들었다')
})

test('★ 회의 만들기가 실패하면 failed 에 담고 짝을 남기지 않는다', async () => {
  const h = harness(userParts(), { create: async () => { throw new Error('서버가 안 받아요') } })
  const r = await adoptOrphanParts(h.deps)
  assert.deepEqual(r.failed.map((f) => f.localId), [LOCAL])
  assert.deepEqual(h.remembered, [])
  assert.deepEqual(h.rekeyed, [])
})

test('서버 id 구간은 고아가 아니다, 끊겨 있으면 아무것도 안 한다', async () => {
  const server = harness(userParts('note_real'))
  const r = await adoptOrphanParts(server.deps)
  assert.equal(r.adopted, 0)
  assert.equal(server.created.length, 0)
  const off = harness(userParts(), { isOnline: () => false })
  const o = await adoptOrphanParts(off.deps)
  assert.equal(o.skipped, true)
  assert.equal(off.created.length, 0)
})

test('잠금 안에서 돈다, 여러 탭이 동시에 입양하면 회의가 두 벌 된다', async () => {
  let locked = 0
  const h = harness(userParts(), { withLock: async <T,>(fn: () => Promise<T>) => { locked += 1; return fn() } })
  await adoptOrphanParts(h.deps)
  assert.equal(locked, 1)
})
