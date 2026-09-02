import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  signalSweepHeadline, signalSweepDetail, signalSweepStuckText, signalSweepEscalation,
  signalStatusLabel, signalCauseLabel, isQuotaMessage, isUnsupportedStageMessage,
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
  assert.equal(signalSweepHeadline(base), '수집 전')
  assert.match(signalSweepDetail(base) ?? '', /지금 수집/)
})

test('★ 돌았는데 0건인 것과 아직 안 돈 것은 다른 문장이다', () => {
  const ran = signalSweepHeadline({ ...base, outcome: 'ok', lastSweepAt: '2026-09-01T00:00:00Z' })
  const never = signalSweepHeadline(base)
  assert.notEqual(ran, never)
  assert.equal(ran, '새 이슈 없음')
})

test('확인 대기가 있으면 건수를 말한다', () => {
  assert.match(signalSweepHeadline({ ...base, outcome: 'ok', pending: 3 }), /3건/)
})

test('★ 두괄식 — 첫 줄만 읽어도 상태와 원인이 끝난다', () => {
  const s: SignalSweepState = {
    ...base, outcome: 'failed', reason: 'AI 웹 검색 한도를 다 썼습니다', blockedByQuota: true,
  }
  assert.equal(signalSweepHeadline(s), '수집 실패 · AI 한도 초과')
  assert.doesNotMatch(signalSweepHeadline(s) + (signalSweepDetail(s) ?? ''), /죄송|미안/)
})

test('재시도 예정도 원인을 첫 줄에 싣는다 — 「곧 됩니다」로 뭉개지 않는다', () => {
  const s: SignalSweepState = { ...base, outcome: 'retrying', reason: '한도 초과', blockedByQuota: true }
  assert.equal(signalSweepHeadline(s), '수집 실패 · 재시도 예정 · AI 한도 초과')
})

test('꺼져 있으면 «실패»가 아니라 «꺼짐»이라고 말한다', () => {
  const s: SignalSweepState = { ...base, outcome: 'off' }
  assert.equal(signalSweepHeadline(s), '자동 수집 꺼짐')
  assert.match(signalSweepDetail(s) ?? '', /설정/)
})

test('돌고 있는 중도 말한다 — 아무 말 없는 상태를 만들지 않는다', () => {
  assert.equal(signalSweepHeadline({ ...base, outcome: 'running' }), '수집 중')
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
  assert.equal(signalSweepStuckText(s, now), '2일째')
  assert.match(signalSweepEscalation(s, now) ?? '', /요금제|키/)
})

test('몇 시간짜리면 기간만 말한다 — 요금제를 의심시키지 않는다', () => {
  const now = Date.parse('2026-09-02T05:00:00Z')
  const s2: SignalSweepState = { ...base, outcome: 'failed', reason: '한도', failingSince: '2026-09-02T00:00:00Z' }
  assert.equal(signalSweepStuckText(s2, now), '5시간째')
  assert.equal(signalSweepEscalation(s2, now), null)
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
  assert.match(src, /지금 수집/, '버튼이 표준 용어를 안 쓴다')
})

// ── 문구 표준 ────────────────────────────────────────────────────────
//
// 사용자 지적(2026-09-02): 「두괄식으로 명확하고 키워드 위주로 서비스를 구성해야지
// 훑는다 이런 시스템은 본적도 없어」. 서술형·비표준어는 재발하면 다시 못 잡으므로 잠근다.

test('★ 상태 라벨은 짧은 키워드다 — 문장이 아니다', () => {
  for (const o of ['never', 'ok', 'running', 'retrying', 'failed', 'off'] as const) {
    const label = signalStatusLabel({ ...base, outcome: o })
    assert.ok(label.length <= 16, `${o}: 라벨이 길다(${label})`)
    assert.doesNotMatch(label, /어요|습니다|해요/, `${o}: 서술형이다(${label})`)
  }
})

test('★ 원인은 키워드로 나온다 — 긴 원문을 첫 줄에 싣지 않는다', () => {
  assert.equal(signalCauseLabel('AI 웹 검색 한도를 다 썼습니다. 모델을 바꿔도…'), 'AI 한도 초과')
  assert.equal(signalCauseLabel('AI 키가 설정되지 않았습니다'), 'AI 키 없음')
  assert.equal(signalCauseLabel('시간 안에 오지 않았습니다'), '응답 지연')
  assert.equal(signalCauseLabel(null), null)
})

test('★ 「훑다」는 화면에 쓰지 않는다 — 제품에서 쓰는 말이 아니다', () => {
  const files = [
    'lib/ci/analysis/signals.ts',
    'components/ci/SignalSweepBar.tsx',
    'lib/ci/jobs/progress.ts',
    'lib/ci/settings/registry.ts',
  ]
  for (const f of files) {
    const src = readFileSync(join(appRoot, f), 'utf8')
    // 주석은 판정 대상이 아니다 — 화면에 나가는 문자열만 본다
    const strings = [...src.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '')
    for (const t of strings) {
      assert.doesNotMatch(t, /훑/, `${f} 의 화면 문자열에 「훑」이 있다: ${t.slice(0, 40)}`)
    }
  }
})

test('★ 배포본이 남긴 «모르는 단계»는 실패가 아니다 — 내부 문구가 화면에 뜨면 안 된다', () => {
  assert.ok(isUnsupportedStageMessage('알 수 없는 단계: signals'))
  assert.ok(isUnsupportedStageMessage('이 워커가 모르는 단계입니다: signals'))
  assert.ok(!isUnsupportedStageMessage('AI 웹 검색 한도를 다 썼습니다'))
  assert.ok(!isUnsupportedStageMessage(null))
})

test('★ 가드: 화면·실행 양쪽이 «모르는 단계» 기록을 건너뛴다 — 한쪽만 하면 또 어긋난다', () => {
  for (const f of ['lib/ci/queries/trends.ts', 'lib/ci/jobs/signals-sweep.ts']) {
    const src = readFileSync(join(appRoot, f), 'utf8')
    assert.match(src, /isUnsupportedStageMessage/, `${f} 가 가짜 실패를 걸러내지 않는다`)
  }
})

test('★ 가드: 「시도한 때」로 성공을 판정하지 않는다 — 실패한 뒤에도 「새 이슈 없음」이 되던 원인', () => {
  const q = readFileSync(join(appRoot, 'lib/ci/queries/trends.ts'), 'utf8')
  assert.match(q, /last_signal_success_at/, '성공 시각 칸을 읽지 않는다')
  // 성공 판정에 시도 시각(lastSweepAt)을 쓰면 안 된다
  const at = q.indexOf('const outcome')
  const decide = q.slice(q.indexOf('if (job?.updated_at'), at > 0 ? at : undefined).slice(0, 600)
  assert.match(decide, /lastSuccessAt/, '성공 판정이 성공 시각을 안 본다')
  assert.doesNotMatch(decide, /lastSweepAt\s*>/, '시도 시각으로 성공을 판정한다')
})

test('★ 가드: 성공했을 때만 성공 시각을 찍는다 — 성공 경로가 하나여야 판정이 안 갈린다', () => {
  const src = readFileSync(join(appRoot, 'lib/ci/ai/signals-server.ts'), 'utf8')
  assert.match(src, /last_signal_success_at/, '성공 시각을 안 찍는다')
  const route = readFileSync(join(appRoot, 'app/api/ci/signals/sweep/route.ts'), 'utf8')
  assert.doesNotMatch(route, /last_signal_success_at/,
    '수동 경로가 성공 시각을 따로 찍는다 — 두 곳이 찍으면 한쪽만 고쳐져 어긋난다')
})

test('★ 가드: 마이그레이션이 성공 시각 칸을 만든다', () => {
  const sql = readFileSync(join(appRoot, '..', '..', 'supabase/migrations/240_ci_signal_success_at.sql'), 'utf8')
  assert.match(sql, /add column if not exists last_signal_success_at/i, '추가 전용이 아니다')
  assert.doesNotMatch(sql, /drop column|delete from|update ci_workspaces set/i, '파괴적 구문이 있다')
})

test('★ 가드: 도는 중에는 실패 색을 쓰지 않는다 — 결과 전에 빨간 글씨는 실패로 읽힌다', () => {
  const src = readFileSync(join(appRoot, 'components/ci/SignalSweepBar.tsx'), 'utf8')
  assert.match(src, /const bad = !busy &&/, '진행 중에도 실패 색이 남는다')
})
