import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  signalSweepHeadline, signalSweepDetail, type SignalSweepState,
} from './signals.ts'

const base: SignalSweepState = { outcome: 'never', lastSweepAt: null, reason: null, pending: 0 }
const here = dirname(fileURLToPath(import.meta.url))
const appRoot = join(here, '..', '..', '..')

// ── 문장 ─────────────────────────────────────────────────────────────

test('한 번도 안 돌았으면 그렇게 말한다 — 빈 화면과 구분되어야 한다', () => {
  assert.match(signalSweepHeadline(base), /아직 바깥을 훑지 않았/)
  assert.match(signalSweepDetail(base) ?? '', /지금 찾기/)
})

test('★ 돌았는데 0건인 것과 아직 안 돈 것은 다른 문장이다', () => {
  const ran = signalSweepHeadline({ ...base, outcome: 'ok', lastSweepAt: '2026-09-01T00:00:00Z' })
  const never = signalSweepHeadline(base)
  assert.notEqual(ran, never)
  assert.match(ran, /새로 담을 만한 것이 없/)
})

test('확인 대기가 있으면 건수를 말한다', () => {
  assert.match(signalSweepHeadline({ ...base, outcome: 'ok', pending: 3 }), /3건/)
})

test('★ 실패는 이유를 그대로 보여준다 — 사과하지 않고 사실을 말한다', () => {
  const s: SignalSweepState = { ...base, outcome: 'failed', reason: 'AI 웹 검색 한도를 다 썼습니다' }
  assert.match(signalSweepHeadline(s), /훑지 못했/)
  assert.equal(signalSweepDetail(s), 'AI 웹 검색 한도를 다 썼습니다')
  assert.doesNotMatch(signalSweepHeadline(s) + (signalSweepDetail(s) ?? ''), /죄송|미안/)
})

test('재시도 예정도 이유를 보여준다 — 「곧 됩니다」로 뭉개지 않는다', () => {
  const s: SignalSweepState = { ...base, outcome: 'retrying', reason: '한도 초과' }
  assert.equal(signalSweepDetail(s), '한도 초과')
})

test('꺼져 있으면 «실패»가 아니라 «꺼짐»이라고 말한다', () => {
  const s: SignalSweepState = { ...base, outcome: 'off' }
  assert.match(signalSweepHeadline(s), /꺼져 있/)
  assert.match(signalSweepDetail(s) ?? '', /설정/)
})

test('돌고 있는 중도 말한다 — 아무 말 없는 상태를 만들지 않는다', () => {
  assert.match(signalSweepHeadline({ ...base, outcome: 'running' }), /훑고 있/)
})

test('★ 어떤 상태에서도 빈 문장이 나오지 않는다', () => {
  for (const o of ['never', 'ok', 'running', 'retrying', 'failed', 'off'] as const) {
    const h = signalSweepHeadline({ ...base, outcome: o })
    assert.ok(h && h.trim().length > 0, `${o} 가 빈 문장을 냈다`)
  }
})

// ── 배선 가드 ────────────────────────────────────────────────────────

test('가드: 이슈 탭이 후보 유무와 무관하게 상태 줄을 그린다', () => {
  const src = readFileSync(join(appRoot, 'app/(ci)/ci/trends/TrendsView.tsx'), 'utf8')
  const bar = src.indexOf('<SignalSweepBar')
  const list = src.indexOf('p.signalCandidates && p.signalCandidates.length > 0')
  assert.ok(bar > 0, '상태 줄이 화면에 없다')
  assert.ok(list > 0 && bar < list, '상태 줄이 후보 목록 조건 안으로 들어갔다 — 0건이면 또 아무 말이 없어진다')
})

test('가드: 「지금 찾기」가 시간 제한·실패 표시·진행 되돌리기를 모두 갖는다', () => {
  const src = readFileSync(join(appRoot, 'components/ci/SignalSweepBar.tsx'), 'utf8')
  assert.match(src, /AbortController/, '시간 제한이 없다')
  assert.match(src, /catch\s*\(/, '실패를 잡지 않는다')
  assert.match(src, /finally\s*\{[\s\S]*?setBusy\(false\)/, '진행 표시를 되돌리지 않는다')
  assert.match(src, /setFailed\(true\)/, '실패를 화면에 표시하지 않는다')
})

test('★ 가드: 모르는 단계는 실패로 세지 않는다 — 배포 전 잡이 죽어 기능이 영영 안 돈다', () => {
  const h = readFileSync(join(appRoot, 'lib/ci/jobs/handlers.ts'), 'utf8')
  assert.match(h, /unsupported:\s*true/, '모르는 단계를 unsupported 로 표시하지 않는다')
  const d = readFileSync(join(appRoot, 'lib/ci/jobs/drain.ts'), 'utf8')
  assert.match(d, /outcome\.unsupported[\s\S]{0,200}?releaseJob/, '모르는 단계를 그냥 실패 처리한다')
})

test('★ 가드: releaseJob 은 다시 집힐 수 있는 상태로 되돌린다', () => {
  const q = readFileSync(join(appRoot, 'lib/ci/jobs/queue.ts'), 'utf8')
  const at = q.indexOf('export async function releaseJob')
  assert.ok(at > 0, 'releaseJob 이 없다')
  const body = q.slice(at, at + 900)
  assert.match(body, /status:\s*'queued'/, "claimJobs 는 queued·failed 만 본다 — 다른 값이면 잡이 영영 안 집힌다")
  assert.doesNotMatch(body, /attempt/, '시도 횟수를 건드리면 재시도 규약이 깨진다')
})

test('가드: 설정 읽기가 두 벌이 되지 않는다 — 공용 로더만 쓴다', () => {
  const s = readFileSync(join(appRoot, 'lib/ci/ai/signals-server.ts'), 'utf8')
  const t = readFileSync(join(appRoot, 'lib/ci/queries/trends.ts'), 'utf8')
  for (const [name, src] of [['signals-server', s], ['trends', t]] as const) {
    assert.doesNotMatch(src, /from\('ci_settings'\)/, `${name} 가 설정 테이블을 직접 읽는다`)
    assert.match(src, /loadWorkspaceSetting/, `${name} 가 공용 로더를 쓰지 않는다`)
  }
})
