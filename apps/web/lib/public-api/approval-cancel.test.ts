/**
 * 승인 요청 취소 창구 (P0170 I08, 지시서 문제 8)
 *
 * 키가 잘못 만든 승인 요청을 지울 길이 없었다. 취소는 그 요청을 만든 키만, 기다리는 중인 것만 된다
 * 서비스롤로 쓰므로 소유 조건(key_id user_id)이 질의에 박혀 있어야 한다 (LOOP.md 7절 S2)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const route = readFileSync(new URL('../../app/api/public/v1/approvals/[id]/cancel/route.ts', import.meta.url), 'utf8')
const code = route.replace(/\/\/.*$/gm, '')

test('읽기와 바꾸기 둘 다 요청을 만든 키로 좁힌다', () => {
  const reads = code.match(/\.eq\('key_id', auth\.ctx\.keyId\)/g) ?? []
  assert.equal(reads.length, 2, '조회와 갱신 모두 key_id 조건이 있어야 한다')
  assert.match(code, /\.eq\('user_id', auth\.ctx\.userId\)/)
})

test('기다리는 중인 것만 바꾸고, 이미 결정된 것은 409 다', () => {
  assert.match(code, /\.update\(\{ status: 'CANCELLED'[^}]*\}\)[\s\S]*?\.eq\('status', 'PENDING'\)/)
  assert.match(code, /fail\(409, API_APPROVAL_ERROR\.not_pending/)
})

test('남의 것과 없는 것은 같은 404, 형식이 틀린 id 도 404', () => {
  const notFound = code.match(/fail\(404, API_APPROVAL_ERROR\.not_found/g) ?? []
  assert.equal(notFound.length, 2)
  assert.match(code, /if \(!isUuid\(id\)\)/)
})

test('DB 상태 제약에 CANCELLED 가 있다', () => {
  const sql = readFileSync(new URL('../../../../supabase/migrations/320_api_approval_cancel.sql', import.meta.url), 'utf8')
  assert.match(sql, /'CANCELLED'/)
})
