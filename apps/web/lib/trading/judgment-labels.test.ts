/**
 * 판단 기록이 **정상인지 화면이 말해 주는가**
 *
 * 사용자 지적 2026-09-28 「정상 동작 하고 있는건지 모르겠네」 — 표에
 * `call_failed:jev_http_403` 이 열여섯 줄 찍혀 있었다. 표식을 보여 주고 해석을 떠넘긴 화면이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { judgmentIssue, failingStreak, streakLine, JUDGE_LABEL } from './judgment-labels.ts'
import { TRADING_APP_DIR } from '../policy/app-dirs.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LIST = readFileSync(join(WEB, TRADING_APP_DIR, 'JudgmentList.tsx'), 'utf8')

const row = (over: Partial<{ judge: string; status: string; abstainReason: string | null }> = {}) => ({
  judge: 'jev', status: 'failed', abstainReason: 'call_failed:jev_http_403', ...over,
})

/* ── 사람 말로 ────────────────────────────────────────── */

test('★ 응답 번호 넷을 갈라 말한다 — 넷의 조치가 다르다', () => {
  const cases: [string, RegExp][] = [
    ['call_failed:jev_http_403', /거절/],
    ['call_failed:jev_http_401', /키/],
    ['call_failed:jev_http_429', /한도/],
    ['call_failed:jev_http_404', /모르는 모델/],
    ['call_failed:jev_http_503', /서버 오류/],
  ]
  const said = new Set<string>()
  for (const [mark, want] of cases) {
    const issue = judgmentIssue(mark)
    assert.ok(issue, `${mark} 을 안 읽는다`)
    assert.match(issue!.text, want)
    assert.equal(issue!.known, true)
    assert.equal(/http|call_failed/.test(issue!.text), false, `기계 글자가 샜다: ${issue!.text}`)
    said.add(issue!.text)
  }
  assert.equal(said.size, cases.length, '서로 다른 일을 같은 말로 한다')
})

test('★ 기다리면 풀리는 것과 손대야 풀리는 것을 가른다', () => {
  assert.equal(judgmentIssue('call_failed:jev_http_429')!.tone, 'waiting')
  assert.equal(judgmentIssue('budget_denied:over')!.tone, 'waiting')
  assert.equal(judgmentIssue('call_failed:jev_http_403')!.tone, 'blocked')
  assert.equal(judgmentIssue('timeout:10000ms')!.tone, 'blocked')
})

test('★ 시간 초과는 몇 초였는지와 할 일을 말한다', () => {
  const issue = judgmentIssue('timeout:10000ms')
  assert.match(issue!.text, /10초/, '몇 초였는지를 안 말한다')
  assert.match(issue!.text, /대기 시간|빠른 모델/, '무엇을 하면 되는지를 안 말한다')
})

test('★ 모르는 표식은 버리지 않고 원문을 그대로 둔다', () => {
  const issue = judgmentIssue('brand_new_marker:7')
  assert.equal(issue!.text, 'brand_new_marker:7')
  assert.equal(issue!.known, false, '모르는 것을 아는 척한다')
})

test('★ 사유가 없으면 없다고 한다 — 빈 말을 지어내지 않는다', () => {
  for (const empty of [null, undefined, '', '  ']) {
    assert.equal(judgmentIssue(empty), null)
  }
})

/* ── 이어지는 실패를 세어 준다 ────────────────────────── */

test('★ 같은 실패가 이어지면 몇 번인지 센다', () => {
  const streak = failingStreak([row(), row(), row(), { judge: 'rule', status: 'completed', abstainReason: null }])
  assert.ok(streak, '이어지는 실패를 안 센다')
  assert.equal(streak!.count, 3)
  assert.equal(streak!.judge, 'jev')
  assert.match(streakLine(streak!), /3번 이어서/)
  assert.match(streakLine(streak!), new RegExp(JUDGE_LABEL.jev))
})

test('★ 다른 이유가 섞이면 거기서 끊는다 — 「N번 이어서」가 거짓말이 되면 안 된다', () => {
  const streak = failingStreak([row(), row(), row({ abstainReason: 'timeout:10000ms' })])
  assert.equal(streak!.count, 2, '다른 이유까지 한 줄로 세었다')
})

test('★ 한 번뿐이면 안 뜬다 — 늘 뜨는 경고는 안 읽힌다', () => {
  assert.equal(failingStreak([row(), { judge: 'rule', status: 'completed', abstainReason: null }]), null)
  assert.equal(failingStreak([{ judge: 'rule', status: 'completed', abstainReason: null }]), null)
  assert.equal(failingStreak([]), null)
})

/**
 * **이미 풀린 일을 계속 경고하지 않는다** (실측 2026-09-28: 시간 초과 둘 뒤에
 * 성공이 쌓였는데도 「2번 이어서 못 했습니다」가 화면에 남아 있었다).
 * 풀린 경고가 남아 있으면 사람은 그 자리를 안 믿게 된다.
 */
test('★ 그 뒤에 성공했으면 안 뜬다 — 지금도 못 하고 있을 때만 말한다', () => {
  // 목록은 최신이 위다
  const rows = [
    { judge: 'jev', status: 'completed', abstainReason: null },
    row(), row(), row(),
  ]
  assert.equal(failingStreak(rows), null, '이미 풀렸는데 경고가 남아 있다')
})

test('★ 판단기마다 따로 본다 — 한쪽이 멀쩡해도 다른 쪽이 막혔으면 말한다', () => {
  const rows = [
    { judge: 'rule', status: 'completed', abstainReason: null },
    row(), 
    { judge: 'rule', status: 'completed', abstainReason: null },
    row(),
  ]
  const streak = failingStreak(rows)
  assert.equal(streak?.judge, 'jev')
  assert.equal(streak?.count, 2)
})

test('★ 성공만 있으면 요약 줄이 없다', () => {
  const rows = [
    { judge: 'rule', status: 'completed', abstainReason: null },
    { judge: 'jev', status: 'completed', abstainReason: null },
  ]
  assert.equal(failingStreak(rows), null)
})

/* ── 화면이 실제로 쓴다 ───────────────────────────────── */

test('★ 표가 기계 글자를 그대로 안 찍는다', () => {
  assert.match(LIST, /judgmentIssue\(r\.abstainReason\)/, '사유를 안 읽는다')
  assert.equal(/\$\{r\.abstainReason\}/.test(LIST), false, '원문을 그대로 찍는다')
})

test('★ 이어지는 실패를 표 위에서 요약한다', () => {
  assert.match(LIST, /failingStreak\(rows\)/, '안 센다')
  assert.match(LIST, /streakLine\(streak\)/, '세어 놓고 안 그린다')
  // 잘 돌 때는 그 줄이 없어야 한다
  assert.match(LIST, /\{streak && \(/, '늘 떠 있는 줄이 된다')
})
