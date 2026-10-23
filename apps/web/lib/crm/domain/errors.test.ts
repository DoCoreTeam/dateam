/**
 * 알 수 없는 서버 실패는 입력 오류가 아니다 (P0161)
 *
 * 예전에는 코드 목록에 그 자리가 없어 VALIDATION_FAILED 를 빌려 썼다.
 * 그래서 머리 없는 브라우저가 시간 초과로 죽어도 응답이 500 인데 code 는 「입력값 오류」였고,
 * 부른 쪽(teamda, 화면)은 다시 시도할지 입력을 고칠지 판단할 수 없었다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CrmError, CRM_ERROR_CODES, CRM_ERROR_HTTP } from './errors.ts'

const HANDLER = readFileSync(join(import.meta.dirname, '..', 'api', 'handler.ts'), 'utf8')

test('INTERNAL 은 500 이고 기본 문장이 내부 구조를 싣지 않는다', () => {
  assert.ok(CRM_ERROR_CODES.includes('INTERNAL'))
  assert.equal(CRM_ERROR_HTTP.INTERNAL, 500)
  const e = new CrmError('INTERNAL')
  assert.equal(e.status, 500)
  assert.doesNotMatch(e.message, /Error|stack|at |prisma|timeout/i)
})

test('★ withCrmApi 의 알 수 없는 실패는 INTERNAL 로 나간다, VALIDATION_FAILED 를 빌리지 않는다', () => {
  const tail = HANDLER.slice(HANDLER.indexOf("handledAs: 'unhandled'"))
  const line = tail.split('\n').find((l) => l.includes('new CrmError('))
  assert.ok(line, '알 수 없는 실패 경로에서 오류를 만드는 줄을 찾지 못했다')
  assert.match(line, /new CrmError\('INTERNAL'/)
  assert.doesNotMatch(line, /VALIDATION_FAILED/)
})

test('보안: 알 수 없는 실패의 응답에 원문 예외(msg)를 싣지 않는다', () => {
  const tail = HANDLER.slice(HANDLER.indexOf("handledAs: 'unhandled'"))
  const block = tail.slice(0, tail.indexOf('readJson'))
  assert.doesNotMatch(block, /new CrmError\([^)]*\bmsg\b/)
  assert.match(block, /status: err\.status|status: 500/)
})
