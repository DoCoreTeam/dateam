/**
 * 단계 이동 AI 검토 가드
 *
 * 이 기능은 **조건표를 대신하러** 왔다. 그래서 조건표가 죽은 이유를 그대로 물려받으면 안 된다.
 *   ① 막으면 안 된다 — 막는 순간 조건표를 AI 로 다시 만든 것뿐이다
 *   ② 저장을 인질로 잡으면 안 된다 — AI 가 죽는 날 이동이 죽는다
 *   ③ 근거 없이 지적하면 안 된다 — 근거 없는 경고는 다음부터 안 읽힌다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import {
  parseStageReview, buildStageReviewBrief, stageReviewPrompt, MAX_FINDINGS,
  type StageReviewBrief,
} from '../ai/prompts/stage-review.v1.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = resolve(HERE, '../../..')
const read = (p: string) => readFileSync(resolve(WEB, p), 'utf8')

const SRC = read('lib/crm/services/stage-review.ts')
const ROUTE = read('app/api/crm/deals/[id]/stage-review/route.ts')
const BOARD = read('app/(crm)/crm/deals/DealBoard.tsx')
const DEAL = read('lib/crm/services/deal.ts')

const BRIEF: StageReviewBrief = {
  dealName: 'GPU 도입', companyName: '삼성SDS',
  fromStage: '검증', toStage: '제안',
  stageNames: ['리드', '검증', '제안', '협상', '성사', '실패'],
  amountText: null, closeDateText: '2026-09-30', ownerName: null,
  contactCount: 0, openTasks: [],
  recentActivities: [{ kind: 'CALL', title: '예산 문의', daysAgo: 3 }],
  lastMeetingSummary: null, daysInPrevStage: 21,
}

// ── 응답 읽기 ────────────────────────────────────────────────────────────────

test('정상 응답을 그대로 읽는다', () => {
  const r = parseStageReview(JSON.stringify({
    verdict: 'check', headline: '견적을 만들 수 없습니다',
    findings: [{ what: '금액이 없습니다', because: '금액: 아직 안 정함' }],
    suggestion: '딜 상세에서 금액 넣기',
  }))
  assert.equal(r.verdict, 'check')
  assert.equal(r.findings.length, 1)
  assert.equal(r.suggestion, '딜 상세에서 금액 넣기')
})

test('코드펜스로 감싸 와도 읽는다 — 모델이 자주 그런다', () => {
  const r = parseStageReview('```json\n{"verdict":"ready","headline":"괜찮습니다","findings":[]}\n```')
  assert.equal(r.headline, '괜찮습니다')
})

test('★ 근거 없는 지적은 버린다 — 왜 그런지 못 대면 그건 잔소리다', () => {
  const r = parseStageReview(JSON.stringify({
    verdict: 'not_ready', headline: '문제 있음',
    findings: [{ what: '금액이 없습니다', because: '' }, { what: '', because: '어쩌고' }],
    suggestion: null,
  }))
  assert.equal(r.findings.length, 0)
})

test('★ 근거가 다 사라지면 결론도 낮춘다 — 근거 0개짜리 "안 됨"은 답을 못 준다', () => {
  const r = parseStageReview(JSON.stringify({
    verdict: 'not_ready', headline: '문제 있음', findings: [], suggestion: null,
  }))
  assert.equal(r.verdict, 'ready')
})

test('걸리는 게 몇 개든 상한을 넘지 않는다 — 다 말하면 다 안 읽는다', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ what: `문제 ${i}`, because: `근거 ${i}` }))
  const r = parseStageReview(JSON.stringify({ verdict: 'check', headline: 'x', findings: many }))
  assert.equal(r.findings.length, MAX_FINDINGS)
})

test('모르는 판정은 check 로 떨어진다 — 실수로 not_ready 가 되면 사람이 놀란다', () => {
  const r = parseStageReview(JSON.stringify({
    verdict: '위험', headline: 'x', findings: [{ what: 'a', because: 'b' }],
  }))
  assert.equal(r.verdict, 'check')
})

test('결론이 없으면 던진다 — 러너가 한 번 더 묻는다', () => {
  assert.throws(() => parseStageReview(JSON.stringify({ verdict: 'check', findings: [] })))
  assert.throws(() => parseStageReview('이건 JSON 이 아니다'))
})

// ── 브리핑·프롬프트 ─────────────────────────────────────────────────────────

test('★ 브리핑에 판단 재료가 다 들어간다 — 여기 없는 것은 모델도 모른다', () => {
  const s = buildStageReviewBrief(BRIEF)
  for (const phrase of ['GPU 도입', '삼성SDS', '검증 → 제안', '아직 안 정함', '21일', '예산 문의']) {
    assert.ok(s.includes(phrase), `브리핑에 없다: ${phrase}`)
  }
})

test('단계 순서를 넘긴다 — 다음 관문을 모르면 준비됐는지 판단할 수 없다', () => {
  assert.ok(buildStageReviewBrief(BRIEF).includes('리드 → 검증 → 제안'))
})

test('★ 프롬프트가 빈칸 읊기를 금지한다 — 그건 화면이 이미 보여 준다', () => {
  const p = stageReviewPrompt.build('x')
  assert.ok(p.includes('빈칸을 그대로 읊지 마세요'), '빈칸 잔소리를 막지 않는다')
  assert.ok(p.includes('왜 그게 지금 문제인지'), '이유를 요구하지 않는다')
})

test('★ 프롬프트가 "막지 않는다"를 못 박는다 — 막으면 조건표를 다시 만든 것이다', () => {
  const p = stageReviewPrompt.build('x')
  assert.ok(p.includes('막지 않습니다'), '막지 않는다는 지시가 없다')
  assert.ok(p.includes('되돌리라고 명령하지 말고'), '되돌리기를 금지하지 않는다')
})

test('프롬프트가 빈 배열을 정답으로 허용한다 — 억지 지적이 기능을 죽인다', () => {
  assert.ok(stageReviewPrompt.build('x').includes('빈 배열도 정답입니다'))
})

// ── 배선 ────────────────────────────────────────────────────────────────────

test('★ 이동은 이 검토를 기다리지 않는다 — 같이 돌면 AI 가 죽는 날 저장이 죽는다', () => {
  assert.ok(!DEAL.includes('reviewStageMove'), '딜 서비스가 검토를 안에서 부른다')
  assert.ok(!DEAL.includes('stage-review'), '이동 트랜잭션이 AI 를 물고 있다')
})

test('★ 보드가 옮긴 뒤 실제로 묻는다 — 만들고 안 꽂으면 없는 기능이다', () => {
  assert.ok(/deals\/\$\{[^}]+\}\/stage-review/.test(BOARD), '보드가 검토를 부르지 않는다')
  assert.ok(BOARD.includes('askReview'), '검토 호출부가 없다')
})

test('★ 검토가 실패해도 사람에게 오류를 띄우지 않는다 — 이동은 이미 성공했다', () => {
  const fn = BOARD.slice(BOARD.indexOf('async function askReview'), BOARD.indexOf('async function move'))
  assert.ok(!fn.includes('setMoveError'), '조언 실패를 이동 실패처럼 보여 준다')
})

test('★ 걸리는 게 없으면 아무 말도 안 한다 — 매번 "괜찮습니다"가 뜨면 그때부터 안 읽는다', () => {
  assert.ok(BOARD.includes("r.verdict === 'ready'"), 'ready 를 걸러내지 않는다')
})

test('근거를 화면이 보여 준다 — 근거 없이 뜬 지적은 조언이 아니다', () => {
  assert.ok(BOARD.includes('f.because'), '근거를 렌더하지 않는다')
})

test('닫을 수 있다 — 못 닫으면 다음 이동까지 남아 방해가 된다', () => {
  assert.ok(BOARD.includes('setReview(null)'), '닫는 길이 없다')
  assert.ok(BOARD.includes('검토 닫기'), '닫기 버튼에 이름이 없다')
})

test('라우트가 로그인·멤버십을 확인한다', () => {
  assert.ok(ROUTE.includes("withCrmApi('MEMBER'"), '인증이 없다')
  assert.ok(ROUTE.includes('reviewStageMove'), '서비스를 안 부른다')
})

test('★ 절대 던지지 않는다 — 조언이 실패했다고 화면이 깨지면 안 된다', () => {
  assert.ok(SRC.includes('catch'), '실패를 잡지 않는다')
  assert.ok(SRC.includes('예산 한도'), '예산 차단을 사람 말로 알리지 않는다')
})

test('★ 모델 선택을 두 벌로 만들지 않는다', () => {
  assert.ok(SRC.includes('adapterFromSetting'), '어댑터를 손으로 고른다')
})

test('★ 새 AI 종류를 만들지 않는다 — enum 을 늘리면 마이그레이션이 필요해진다', () => {
  assert.ok(/kind:\s*'ASSISTANT'/.test(SRC), '기존 종류를 쓰지 않는다')
})

test('체류 기간은 초를 날로 바꿔 넘긴다 — 이력은 초로 적힌다', () => {
  assert.ok(SRC.includes('durationSec'), '이력 컬럼을 안 읽는다')
  assert.ok(SRC.includes('86_400'), '초를 날로 바꾸지 않는다')
})
