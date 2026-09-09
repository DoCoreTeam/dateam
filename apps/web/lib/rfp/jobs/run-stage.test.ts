import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runStage, versionOf, type StageDeps, type CaseRow, type FileRow } from './run-stage.ts'
import type { Job } from './queue.ts'
import type { IrDocument } from '../ir/types.ts'

const KASE: CaseRow = {
  id: 'c1', orgId: 'o1', docClass: 'public', title: '이름을 읽는 중', titleConfirmed: false,
}

const DOC = { meta: { parser: 'x' }, blocks: [], sections: [] } as unknown as IrDocument

function job(jobType: string, payload: Record<string, unknown> = {}): Job {
  return {
    id: 'j1', orgId: 'o1', caseId: 'c1', jobType: jobType as Job['jobType'],
    payload, priority: 1, status: 'running', attempts: 1, lockedBy: 'w', error: null, dedupeKey: null,
  }
}

function deps(over: Partial<StageDeps> = {}) {
  const calls: string[] = []
  const enqueued: { jobType: string; dedupeKey: string; version: number }[] = []
  const stages: string[] = []
  const titles: string[] = []
  const files: FileRow[] = [
    { id: 'f1', role: 'main', originalName: '제안요청서.hwp', storagePath: 'o1/c1/aa.bin' },
  ]
  const base: StageDeps = {
    async loadCase() { calls.push('loadCase'); return KASE },
    async loadFiles() { return files },
    async parseOne() { calls.push('parseOne'); return { ok: true, doc: DOC } },
    async saveIr() { calls.push('saveIr') },
    async loadIrDocs() { return [{ fileId: 'f1', doc: DOC }] },
    async saveRequirements() { calls.push('saveRequirements'); return 12 },
    async saveChunks() { calls.push('saveChunks'); return 40 },
    async analyze() { calls.push('analyze'); return { version: 1, title: '차세대 통합 플랫폼' } },
    async setStage(_c, s) { stages.push(s) },
    async setTitle(_c, t) { titles.push(t) },
    async enqueue(i) { enqueued.push({ jobType: i.jobType, dedupeKey: i.dedupeKey, version: i.version }) },
  }
  return { d: { ...base, ...over }, calls, enqueued, stages, titles, files }
}

test('파싱이 끝나면 다음 단계를 스스로 건다 — 크론이 이어 주면 조용히 멈춘다', async () => {
  const f = deps()
  const out = await runStage(f.d, job('parse'))
  assert.equal(out.parsed, 1)
  assert.deepEqual(f.stages, ['parsed'])
  assert.equal(f.enqueued[0].jobType, 'structure')
})

test('네 단계가 순서대로 이어진다', async () => {
  const chain: Record<string, string | undefined> = {}
  for (const t of ['parse', 'structure', 'index', 'analyze']) {
    const f = deps()
    await runStage(f.d, job(t))
    chain[t] = f.enqueued[0]?.jobType
  }
  assert.deepEqual(chain, {
    parse: 'structure', structure: 'index', index: 'analyze', analyze: undefined,
  })
})

test('같은 판이면 같은 키 — 되살아난 잡이 두 번 걸지 않는다', async () => {
  const a = deps(); await runStage(a.d, job('parse', { version: 3 }))
  const b = deps(); await runStage(b.d, job('parse', { version: 3 }))
  assert.equal(a.enqueued[0].dedupeKey, b.enqueued[0].dedupeKey)
  const c = deps(); await runStage(c.d, job('parse', { version: 4 }))
  assert.notEqual(a.enqueued[0].dedupeKey, c.enqueued[0].dedupeKey)
})

test('판 번호를 다음 단계에 물려준다 — 안 물려주면 IR 이 두 벌이 된다', async () => {
  const f = deps()
  await runStage(f.d, job('parse', { version: 6 }))
  assert.equal(f.enqueued[0].version, 6)
})

test('한 파일이 안 읽혀도 나머지로 이어 간다', async () => {
  let n = 0
  const f = deps({
    async loadFiles() {
      return [
        { id: 'f1', role: 'main', originalName: 'a.hwp', storagePath: 'p1' },
        { id: 'f2', role: 'etc', originalName: 'b.hwp', storagePath: 'p2' },
      ]
    },
    async parseOne() {
      n += 1
      return n === 1 ? { ok: false, reason: 'drm_distribution' } : { ok: true, doc: DOC }
    },
  })
  const out = await runStage(f.d, job('parse'))
  assert.equal(out.parsed, 1)
  assert.equal((out.failed as unknown[]).length, 1)
})

test('한 건도 못 읽으면 실패다 — 성공으로 두면 빈 리포트가 나온다', async () => {
  const f = deps({ async parseOne() { return { ok: false, reason: 'password_protected' } } })
  await assert.rejects(() => runStage(f.d, job('parse')), /읽을 수 있는 파일이 없다/)
  assert.deepEqual(f.stages, [])   // 단계도 안 올린다
  assert.deepEqual(f.enqueued, []) // 다음 잡도 안 건다
})

test('바이트가 없는 파일은 시도하지 않고 사유로 남는다', async () => {
  const f = deps({
    async loadFiles() {
      return [{ id: 'f1', role: 'main', originalName: 'a.hwp', storagePath: null }]
    },
  })
  await assert.rejects(() => runStage(f.d, job('parse')), /no_bytes/)
  assert.equal(f.calls.includes('parseOne'), false)
})

test('분석이 찾은 사업명으로 임시 이름을 대신한다', async () => {
  const f = deps()
  await runStage(f.d, job('analyze'))
  assert.deepEqual(f.titles, ['차세대 통합 플랫폼'])
})

test('사람이 고친 이름은 AI 가 덮지 않는다', async () => {
  const f = deps({
    async loadCase() { return { ...KASE, title: '내가 정한 이름', titleConfirmed: true } },
  })
  await runStage(f.d, job('analyze'))
  assert.deepEqual(f.titles, [])
})

test('파싱 결과가 없으면 뒤 단계는 실패한다 — 빈 것으로 이어 가지 않는다', async () => {
  for (const t of ['structure', 'index', 'analyze']) {
    const f = deps({ async loadIrDocs() { return [] } })
    await assert.rejects(() => runStage(f.d, job(t)), /파싱 결과가 없다/, t)
  }
})

test('모르는 종류는 조용히 성공하지 않는다', async () => {
  const f = deps()
  await assert.rejects(() => runStage(f.d, job('cross_verify')), /아직 붙지 않은 단계다/)
})

test('판 번호는 payload 에서 온다', () => {
  assert.equal(versionOf(job('parse')), 1)
  assert.equal(versionOf(job('parse', { version: 5 })), 5)
  assert.equal(versionOf(job('parse', { version: 'x' })), 1)
  assert.equal(versionOf(job('parse', { version: 0 })), 1)
})
