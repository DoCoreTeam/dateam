// lib/api-docs/agent-doc.test.ts - 개발자센터 에이전트용 안내 절의 값이 원본에서 오는지 (P0168)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as doc from './agent-doc.ts'
import { DEVCENTER_DEFAULT_RATE_LIMIT } from '../terms/devcenter.ts'
import { ENDPOINTS } from './registry.ts'

const ROUTE = fileURLToPath(new URL('../../app/api/public/v1/openapi.json/route.ts', import.meta.url))

function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) value.forEach((v) => allStrings(v, out))
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => allStrings(v, out))
  return out
}

test('명세 경로는 /api/public/v1/openapi.json 이고 route 는 X-API-Key 로 키를 요구한다', () => {
  assert.equal(doc.AGENT_SPEC_PATH, '/api/public/v1/openapi.json')
  const route = readFileSync(ROUTE, 'utf8')
  assert.ok(route.includes('authenticatePublicApi(request)'), '명세 라우트가 키를 확인한다')
  assert.ok(route.includes(`name: '${doc.AGENT_KEY_HEADER}'`), '헤더 이름이 같다')
  const curl = doc.agentSpecCurl('https://example.test')
  assert.ok(curl.includes('https://example.test/api/public/v1/openapi.json'))
  assert.ok(curl.includes('X-API-Key: <API 키>'))
  assert.ok(!/ax_live_[A-Za-z0-9]/.test(curl), '실제 키 모양이 없다')
})

test('승인 흐름은 셋 이상이고 202 와 registry 의 상태 경로를 말한다', () => {
  const steps = doc.AGENT_DOC.approvalSteps
  assert.ok(steps.length >= 3)
  assert.ok(steps.some((s) => s.includes('202')))
  const ref = ENDPOINTS.find((e) => e.id === 'ref.approval')
  assert.ok(ref, 'ref.approval 이 있다')
  assert.equal(doc.AGENT_APPROVAL_STATUS_PATH, `/api/public/v1${ref.path}`)
  assert.ok(steps.some((s) => s.includes(`GET ${doc.AGENT_APPROVAL_STATUS_PATH}`)))
})

test('CLI 에이전트용 teamda help --json 과 웹훅 없음 문장이 있다', () => {
  assert.ok(doc.AGENT_DOC.cliBody.includes('teamda help --json'))
  assert.equal(doc.AGENT_DOC.webhookBody.startsWith('웹훅은 없습니다'), true)
})

test('폴링 간격은 분당 한도 상수에서 나온다', () => {
  assert.equal(doc.pollIntervalSeconds(60), 2)
  assert.equal(doc.pollIntervalSeconds(120), 1)
  assert.notEqual(doc.buildAgentDoc(60).pollBody, doc.buildAgentDoc(120).pollBody)
  assert.ok(doc.buildAgentDoc(120).pollBody.includes('기본 120회'))
  assert.equal(doc.AGENT_DOC.pollIntervalSeconds, doc.pollIntervalSeconds(DEVCENTER_DEFAULT_RATE_LIMIT))
  assert.ok(doc.AGENT_DOC.pollBody.includes(`기본 ${DEVCENTER_DEFAULT_RATE_LIMIT}회`))
  assert.ok(doc.AGENT_DOC.pollBody.includes(`${doc.AGENT_DOC.pollIntervalSeconds}초 이상`))
  assert.ok(doc.AGENT_DOC.approvalSteps.some((s) => s.includes(`${doc.AGENT_DOC.pollIntervalSeconds}초 이상`)))
})

test('내보낸 문자열에 전각 대시와 한자가 없다', () => {
  const texts = allStrings([doc.AGENT_DOC, doc.agentSpecCurl('https://example.test'), doc.AGENT_CLI_HELP])
  assert.ok(texts.length > 10)
  for (const t of texts) {
    assert.ok(!t.includes('—'), `전각 대시: ${t}`)
    assert.ok(!/[一-鿿]/.test(t), `한자: ${t}`)
  }
})

test('개발자센터 목차가 에이전트용 안내와 API 변경 내역 절을 열고 그린다', () => {
  const page = readFileSync(fileURLToPath(new URL('../../app/develop/page.tsx', import.meta.url)), 'utf8')
  assert.match(page, /\{ id: 'agent', l: AGENT_DOC\.nav \}/)
  assert.match(page, /\{ id: 'changes', l: API_CHANGES_DOC\.nav \}/)
  assert.match(page, /activeSection === 'agent' && <AgentGuideSection /)
  assert.match(page, /activeSection === 'changes' && <ApiChangesSection /)
})
