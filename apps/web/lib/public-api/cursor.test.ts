/**
 * 공개 API 구 CRM 창구가 관리자 키만 받고, 커서와 본문으로 필터나 칸을 덧붙일 수 없는지 본다
 *
 * **왜**: accounts contacts deals 공개 창구가 서비스롤로 돌면서 키 소유자의 역할을 안 봤다.
 *   외부용 api_user 키로도 전사 CRM 을 읽고 만들 수 있었다. 내부 창구는 requireAdminApi 인데
 *   API 가 화면보다 더 많이 할 수 있었다(감사 2026-10-23).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseListCursor, cursorFilter } from './cursor.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(WEB, rel), 'utf8')

const GOOD = '2026-10-20T03:04:05.123456+00:00__4f6c1f3e-0b5a-4f7e-9d2a-1c2b3d4e5f60'

test('우리가 만든 모양의 커서는 읽는다', () => {
  assert.deepEqual(parseListCursor(GOOD), {
    time: '2026-10-20T03:04:05.123456+00:00',
    id: '4f6c1f3e-0b5a-4f7e-9d2a-1c2b3d4e5f60',
  })
  assert.equal(
    cursorFilter(parseListCursor(GOOD)!),
    'created_at.lt.2026-10-20T03:04:05.123456+00:00,and(created_at.eq.2026-10-20T03:04:05.123456+00:00,id.lt.4f6c1f3e-0b5a-4f7e-9d2a-1c2b3d4e5f60)',
  )
})

test('필터를 덧붙이려는 커서는 없는 것으로 친다', () => {
  for (const bad of [
    '2026-10-20T03:04:05Z,user_id.eq.x__4f6c1f3e-0b5a-4f7e-9d2a-1c2b3d4e5f60',
    '2026-10-20T03:04:05Z__4f6c1f3e-0b5a-4f7e-9d2a-1c2b3d4e5f60),or(id.gt.0',
    '2026-10-20__4f6c1f3e-0b5a-4f7e-9d2a-1c2b3d4e5f60',
    `${GOOD}__extra`,
    'garbage',
    '',
    null,
  ]) {
    assert.equal(parseListCursor(bad), null, String(bad))
  }
})

const ROUTES = [
  'app/api/public/v1/accounts/route.ts',
  'app/api/public/v1/accounts/[id]/route.ts',
  'app/api/public/v1/contacts/route.ts',
  'app/api/public/v1/contacts/[id]/route.ts',
  'app/api/public/v1/deals/route.ts',
  'app/api/public/v1/deals/[id]/route.ts',
]

test('★ 구 CRM 공개 창구의 처리기는 전부 관리자 키 게이트를 지난다', () => {
  for (const rel of ROUTES) {
    const src = read(rel)
    const handlers = [...src.matchAll(/export async function (GET|POST|PATCH|DELETE)\b/g)].map((m) => m.index!)
    assert.ok(handlers.length > 0, rel)
    for (const [i, start] of handlers.entries()) {
      const body = src.slice(start, handlers[i + 1] ?? src.length)
      const gate = body.indexOf('requireAdminKey(auth.ctx, request)')
      const db = body.indexOf('createAdminClient()')
      assert.ok(gate > 0, `${rel} 처리기 ${i + 1} 에 관리자 키 게이트가 없다`)
      assert.ok(db < 0 || gate < db, `${rel} 처리기 ${i + 1} 이 게이트보다 먼저 DB 를 연다`)
    }
  }
})

test('★ 만들기는 허용 칸만 저장하고 커서는 검증을 지난다', () => {
  for (const rel of ROUTES.filter((r) => !r.includes('[id]'))) {
    const src = read(rel)
    assert.doesNotMatch(src, /\.\.\.body\b|\.\.\.payload\b/, `${rel} 가 본문을 통째로 저장한다`)
    assert.doesNotMatch(src, /cursorRaw\.split/, `${rel} 가 커서를 검증 없이 쪼갠다`)
    assert.match(src, /parseListCursor\(/, rel)
  }
})
