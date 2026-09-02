import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  signalSweepHeadline, signalSweepDetail, signalSweepStuckText, isQuotaMessage,
  type SignalSweepState,
} from './signals.ts'
import {
  effectiveSignalIntervalHours, nextSignalSweepAt, BLOCKED_RETRY_INTERVAL_HOURS,
} from '../jobs/signals-sweep-policy.ts'

const base: SignalSweepState = {
  outcome: 'never', lastSweepAt: null, reason: null, pending: 0,
  nextAttemptAt: null, blockedByQuota: false, failingSince: null,
}
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

// ── 「언제까지 기다리나」 ─────────────────────────────────────────────
//
// 구글은 429 에 retry-after 도 초기화 시각도 주지 않는다(실측 2026-09-02).
// 그래서 «언제 풀리는지»는 못 보여준다 — 대신 «언제 다시 해보는지»와 «며칠째인지»를 말한다.

test('★ 한도에 막히면 재시도 주기를 짧게 한다 — 풀린 순간을 12시간 뒤에 알면 종일 빈 화면이다', () => {
  assert.equal(effectiveSignalIntervalHours(12, true), BLOCKED_RETRY_INTERVAL_HOURS)
  assert.equal(effectiveSignalIntervalHours(12, false), 12)
})

test('설정이 이미 더 짧으면 정책이 늘리지 않는다', () => {
  assert.equal(effectiveSignalIntervalHours(1, true), 1)
  assert.ok(effectiveSignalIntervalHours(2, true) <= 2)
})

test('★ 다음 자동 시도 시각이 계산된다 — 「기다리세요」에 기한이 붙는다', () => {
  const now = Date.parse('2026-09-02T00:00:00Z')
  assert.equal(nextSignalSweepAt('2026-09-01T23:00:00Z', 12, now), '2026-09-02T11:00:00.000Z')
  // 이미 지났으면 지금이 그 시각이다 — 과거를 「다음」이라고 말하지 않는다
  assert.equal(nextSignalSweepAt('2026-08-01T00:00:00Z', 12, now), new Date(now).toISOString())
  // 한 번도 안 훑었으면 지금
  assert.equal(nextSignalSweepAt(null, 12, now), new Date(now).toISOString())
})

test('★ 하루를 넘기면 «기다려서 될 일이 아닐 수 있다»고 말한다 — 영원히 기다리지 않게', () => {
  const now = Date.parse('2026-09-03T00:00:00Z')
  const s: SignalSweepState = {
    ...base, outcome: 'failed', reason: '한도', failingSince: '2026-09-01T00:00:00Z',
  }
  const t = signalSweepStuckText(s, now)
  assert.match(t ?? '', /2일째/)
  assert.match(t ?? '', /요금제|키/)
})

test('몇 시간짜리면 기간만 말한다 — 요금제를 의심시키지 않는다', () => {
  const now = Date.parse('2026-09-02T05:00:00Z')
  const t = signalSweepStuckText(
    { ...base, outcome: 'failed', reason: '한도', failingSince: '2026-09-02T00:00:00Z' }, now)
  assert.match(t ?? '', /5시간째/)
  assert.doesNotMatch(t ?? '', /요금제/)
})

test('성공 중이거나 시작점이 없으면 「며칠째」를 말하지 않는다', () => {
  assert.equal(signalSweepStuckText({ ...base, outcome: 'ok', failingSince: '2026-09-01T00:00:00Z' }), null)
  assert.equal(signalSweepStuckText({ ...base, outcome: 'failed' }), null)
})

test('★ 한도 판정이 한 벌이다 — 재시도·화면·오류코드가 같은 함수를 본다', () => {
  assert.ok(isQuotaMessage('AI 웹 검색 한도를 다 썼습니다'))
  assert.ok(isQuotaMessage('429 RESOURCE_EXHAUSTED'))
  assert.ok(isQuotaMessage('You exceeded your current quota'))
  assert.ok(!isQuotaMessage('네트워크에 연결하지 못했습니다'))
  assert.ok(!isQuotaMessage(''))
  assert.ok(!isQuotaMessage(null))
})

test('★ 가드: 화면과 실행이 같은 주기 계산을 쓴다 — 다르면 화면이 거짓 시각을 말한다', () => {
  const q = readFileSync(join(appRoot, 'lib/ci/queries/trends.ts'), 'utf8')
  assert.match(q, /effectiveSignalIntervalHours/, '화면이 자기 계산을 따로 한다')
  assert.match(q, /nextSignalSweepAt/, '다음 시도 시각을 계산하지 않는다')
  const j = readFileSync(join(appRoot, 'lib/ci/jobs/signals-sweep.ts'), 'utf8')
  assert.match(j, /effectiveSignalIntervalHours/, '실행이 한도 상태를 반영하지 않는다')
})

test('★ 가드: 시스템 로그가 내부 이름을 그대로 내보내지 않는다', () => {
  const labels = readFileSync(join(appRoot, 'lib/system-log/labels.ts'), 'utf8')
  const used = readFileSync(join(appRoot, 'lib/ci/ai/signals-server.ts'), 'utf8')
  const keys = [...used.matchAll(/feature: '([^']+)'/g)].map((m) => m[1])
  assert.ok(keys.length > 0, 'feature 키를 못 찾았다')
  for (const k of keys) {
    assert.ok(labels.includes(`'${k}'`), `${k} 의 사람 이름이 없다 — 화면에 코드 이름이 뜬다`)
  }
})

test('★ 가드: 화면이 다음 시도 시각과 정체 기간을 실제로 그린다', () => {
  const src = readFileSync(join(appRoot, 'components/ci/SignalSweepBar.tsx'), 'utf8')
  assert.match(src, /nextAttemptAt/, '다음 시도 시각을 안 그린다')
  assert.match(src, /signalSweepStuckText/, '며칠째인지 안 그린다')
})
