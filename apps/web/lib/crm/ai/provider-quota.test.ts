// AI 프로바이더 한도(429)가 여러 건 도는 작업을 **멈추는가**
//
// **왜 이 가드가 있는가**(v0.7.574 실측):
//   회사 20곳을 골라 AI 보강을 눌렀는데 Gemini 한도가 이미 소진된 상태였다. 그런데
//   ① 러너가 429 를 `VALIDATION_FAILED`(HTTP 400)로 던졌고 — 화면에는 "입력값을 확인해 주세요" 계열이 떴다
//   ② 일괄 처리의 중단 조건이 `BUDGET_BLOCKED` **하나뿐**이라 429 는 안 걸렸다
//   → 20곳을 끝까지 돌았고, 회사당 재시도 2회가 곱해져 **최대 40번의 확정된 실패 호출**이 나갔다
//   → 화면에는 회사 이름 없는 **똑같은 문장이 20줄** 쌓였다
//
// 이 파일이 지키는 것은 "429 를 잘 분류한다"가 아니라 **"429 를 만나면 더 안 부른다"**이다.
//
// 왜 실행 테스트가 아니라 일부는 정적 스캔인가: `enrichCompaniesFromWeb` 은 `runAi` →
// `reserveBudget` → `withCrmTx`(실제 Prisma)까지 타서 DB 없이는 못 돈다. 그래서
// **판정(순수 함수)은 실행으로**, **그 판정을 실제로 쓰는지는 소스 스캔으로** 잠근다.
// 둘 중 하나만 있으면 "규칙은 맞는데 아무도 안 부르는" 상태를 못 잡는다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CrmError, CRM_ERROR_HTTP, CRM_STOP_BATCH_CODES, stopsBatch,
} from '../domain/errors.ts'
import { classifyProviderError } from '../../ai-chat/provider-errors.ts'

const RUNNER = readFileSync(new URL('./runner.ts', import.meta.url), 'utf8')
const ENRICH_WEB = readFileSync(
  new URL('../services/enrich-web.ts', import.meta.url), 'utf8')
const BULK_ROUTE = readFileSync(
  new URL('../../../app/api/crm/companies/enrich/route.ts', import.meta.url), 'utf8')
const ONE_ROUTE = readFileSync(
  new URL('../../../app/api/crm/companies/[id]/enrich/route.ts', import.meta.url), 'utf8')

// ── 판정 ────────────────────────────────────────────────────────────

test('프로바이더 한도는 429 로 나간다 — 400 "입력값을 확인해 주세요"가 아니다', () => {
  assert.equal(CRM_ERROR_HTTP.PROVIDER_QUOTA, 429)
  assert.equal(new CrmError('PROVIDER_QUOTA').status, 429)
})

test('한도·예산은 둘 다 남은 건을 멈춘다', () => {
  assert.ok(stopsBatch(new CrmError('PROVIDER_QUOTA')))
  assert.ok(stopsBatch(new CrmError('BUDGET_BLOCKED')))
})

test('개별 건의 실패는 멈추지 않는다 — 나머지 회사는 계속 돌아야 한다', () => {
  // 모델이 헛소리를 했다 · 이 회사만 못 찾았다 → 다음 회사는 될 수도 있다
  for (const code of ['AI_PARSE_FAILED', 'NOT_FOUND', 'VALIDATION_FAILED', 'CONFLICT'] as const) {
    assert.equal(stopsBatch(new CrmError(code)), false, `${code} 는 멈추면 안 된다`)
  }
  // CrmError 가 아닌 것(네트워크 예외 등)도 멈추지 않는다
  assert.equal(stopsBatch(new Error('boom')), false)
  assert.equal(stopsBatch(null), false)
})

test('실제 Gemini 429 원문이 한도로 분류된다 — 이 문자열이 사고의 출발점이었다', () => {
  const raw = new Error(
    'Gemini API 오류 (429): { "error": { "code": 429, "message": ' +
    '"You exceeded your current quota, please check your plan and billing details." } }')
  const c = classifyProviderError(raw)
  assert.equal(c.availability, 'limited')
  // 원문을 그대로 올리지 않는다 — 사용자가 무엇을 해야 하는지 알 수 없다
  assert.ok(!c.message.includes('429'), '사용자 문구에 원문이 새면 안 된다')
  assert.ok(c.message.includes('한도'))
})

test('요금제에서 못 쓰는 모델(limit: 0)도 멈춘다 — 재시도해도 영원히 같다', () => {
  const c = classifyProviderError(new Error('quota exceeded (limit: 0)'))
  assert.equal(c.availability, 'unavailable')
  assert.ok(c.fatalModel)
})

// ── 그 판정을 실제로 쓰는가 ─────────────────────────────────────────

test('러너는 availability 가 있으면 PROVIDER_QUOTA 로 던진다', () => {
  assert.match(
    RUNNER,
    /provider\.availability\s*\?\s*'PROVIDER_QUOTA'\s*:\s*'VALIDATION_FAILED'/,
    '429 를 VALIDATION_FAILED 로 되돌리면 중단 조건에 안 걸린다',
  )
})

test('일괄 보강은 중단 조건을 SSOT(stopsBatch)에 맡긴다 — 코드 이름을 직접 적지 않는다', () => {
  assert.ok(ENRICH_WEB.includes('stopsBatch(e)'), 'stopsBatch 로 판정해야 한다')
  // 예전 형태: `e.code === 'BUDGET_BLOCKED'` — 새 중단 사유가 생겨도 이 줄만 모른 채 계속 돌았다
  assert.ok(
    !/e\.code\s*===\s*'BUDGET_BLOCKED'/.test(ENRICH_WEB),
    '중단 코드를 손으로 나열하면 새 사유가 생겼을 때 여기만 빠진다',
  )
})

test('멈췄으면 남은 회사를 명시한다 — 조용히 사라지면 안 된다', () => {
  assert.ok(ENRICH_WEB.includes('notStarted'), '시작 못 한 건을 돌려줘야 한다')
  assert.ok(ENRICH_WEB.includes('stoppedReason'), '왜 멈췄는지 한 번은 말해야 한다')
  // 중단 지점 이후 전부를 담는가 (일부만 담으면 나머지는 여전히 사라진다)
  assert.match(ENRICH_WEB, /companyIds\.slice\(i \+ 1\)/)
})

// ── 프로덕션에서만 터지는 결함 ──────────────────────────────────────

test('보강 라우트는 maxDuration 을 선언한다 — 로컬에는 시간 상한이 없어 안 보이는 결함이다', () => {
  // 회사당 15~30초 × 상한 20곳 = 최악 5~10분. 선언이 없으면 응답 전에 함수가 죽는다.
  assert.match(BULK_ROUTE, /export const maxDuration = 300\b/)
  assert.match(ONE_ROUTE, /export const maxDuration = 60\b/)
})

test('중단 코드 목록에 개별 실패가 섞이지 않았다', () => {
  // 이 목록이 커지면 "한 건 실패했는데 나머지를 통째로 포기"하는 회귀가 된다
  assert.deepEqual([...CRM_STOP_BATCH_CODES].sort(), ['BUDGET_BLOCKED', 'PROVIDER_QUOTA'])
})
