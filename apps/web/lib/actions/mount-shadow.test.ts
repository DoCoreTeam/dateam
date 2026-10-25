/**
 * 관문 경로가 공개 라우트 파일에 가로채이지 않는다 (P0170 I09, 지시서 문제 9)
 *
 * POST /crm/companies/enrich 를 crm/companies/[id]/route.ts 가 먼저 잡아(id=enrich) 405 였다
 * Next 는 정적 > 동적 > 모두 받기 순으로 파일을 고른다, 고른 파일이 그 메서드를 관문으로 넘기지 않으면 관문에 못 닿는다
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MOUNTED } from './generated/table.ts'
// @ts-expect-error 생성기는 타입 없는 mjs 다
import { shadowedByPublicRoute } from '../../../../scripts/cli/gen.mjs'

test('정의 표의 모든 공개 경로가 관문에 닿는다', () => {
  const lost = MOUNTED
    .filter((op) => shadowedByPublicRoute(op.method, op.mount.replace(/\{(\w+)\*?\}/g, 'v')))
    .map((op) => `${op.cli}: ${op.method} ${op.mount}`)
  assert.deepEqual(lost, [])
})

test('가로챔 판정이 실제로 가로챔을 본다 (enrich 는 /web 밖이면 [id] 에 잡힌다)', () => {
  assert.equal(shadowedByPublicRoute('POST', '/crm/companies/enrich'), true)
  assert.equal(shadowedByPublicRoute('POST', '/web/crm/companies/enrich'), false)
  assert.equal(shadowedByPublicRoute('PATCH', '/crm/companies/c1'), false, '[id] 의 PATCH 는 관문으로 넘긴다')
})
