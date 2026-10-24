/**
 * 공개 API 게시물 목록이 cursor 를 읽어 다음 쪽을 겹침 없이 준다 (P0165 I03)
 *
 * **왜**: /api/public/v1/ci/contents 가 nextCursor 를 돌려주면서 cursor 를 안 읽었다.
 *   2쪽을 부를 길이 없었다. 발견 시각만으로 정렬하면 같은 시각 줄이 쪽 경계에서 겹치거나 빠진다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseListCursor, cursorFilter, encodeListCursor, pageByCursor, INVALID_CURSOR_MESSAGE, type ListCursor,
} from './cursor.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (...p: string[]) => readFileSync(join(WEB, ...p), 'utf8')

interface Row { id: string; first_seen_at: string }

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const T1 = '2026-10-24T01:00:00.123456+00:00'
const T2 = '2026-10-23T01:00:00+00:00'

/** 같은 시각 줄이 여럿인 표 (쪽 경계에 걸리게 만든다) */
const TABLE: Row[] = [
  ...[1, 2, 3, 4].map((n) => ({ id: uuid(n), first_seen_at: T1 })),
  ...[5, 6, 7].map((n) => ({ id: uuid(n), first_seen_at: T2 })),
]

/** DB 가 하는 일을 흉내: (시각 내림, id 내림) 정렬 + cursorFilter 와 같은 조건 + limit+1 */
function query(after: ListCursor | null, limit: number): Row[] {
  return [...TABLE]
    .sort((a, b) => (a.first_seen_at === b.first_seen_at
      ? b.id.localeCompare(a.id)
      : Date.parse(b.first_seen_at) - Date.parse(a.first_seen_at)))
    .filter((r) => !after
      || Date.parse(r.first_seen_at) < Date.parse(after.time)
      || (r.first_seen_at === after.time && r.id < after.id))
    .slice(0, limit + 1)
}

const pageOf = (after: ListCursor | null, limit: number) =>
  pageByCursor(query(after, limit), limit, (r) => r.first_seen_at, (r) => r.id)

test('1쪽의 nextCursor 로 부른 2쪽은 1쪽과 겹치지 않고, 끝까지 넘기면 전부 한 번씩 나온다', () => {
  // Arrange
  const limit = 2
  const seen: string[] = []
  let after: ListCursor | null = null

  // Act
  for (let guard = 0; guard < 10; guard++) {
    const page = pageOf(after, limit)
    seen.push(...page.items.map((r) => r.id))
    if (!page.nextCursor) break
    after = parseListCursor(page.nextCursor)
    assert.ok(after, `우리가 만든 커서는 다시 읽혀야 한다: ${page.nextCursor}`)
  }

  // Assert
  assert.equal(new Set(seen).size, seen.length, `겹침: ${seen.join(',')}`)
  assert.deepEqual([...seen].sort(), TABLE.map((r) => r.id).sort())
})

test('1쪽과 2쪽을 직접 비교한다 (같은 시각 줄이 경계에 걸린 경우)', () => {
  // Arrange
  const first = pageOf(null, 3)

  // Act
  const second = pageOf(parseListCursor(first.nextCursor), 3)

  // Assert
  assert.equal(first.hasMore, true)
  assert.deepEqual(first.items.map((r) => r.id), [uuid(4), uuid(3), uuid(2)])
  assert.deepEqual(second.items.map((r) => r.id), [uuid(1), uuid(7), uuid(6)])
  assert.equal(first.items.some((r) => second.items.includes(r)), false)
})

test('마지막 쪽은 nextCursor 가 null 이다', () => {
  const page = pageByCursor(TABLE.slice(0, 2), 5, (r) => r.first_seen_at, (r) => r.id)
  assert.equal(page.nextCursor, null)
  assert.equal(page.hasMore, false)
  assert.equal(page.items.length, 2)
})

test('커서는 DB 시각 꼴(마이크로초와 +00:00) 그대로 왕복한다', () => {
  const raw = encodeListCursor(T1, uuid(9))
  assert.deepEqual(parseListCursor(raw), { time: T1, id: uuid(9) })
})

test('잘못된 커서는 읽히지 않는다 (라우트가 400 으로 돌려준다)', () => {
  for (const bad of ['12', 'abc__def', `${T1}__${uuid(1)}__x`, `${T1},id.gt.0__${uuid(1)}`, `${T1}__${uuid(1)})`]) {
    assert.equal(parseListCursor(bad), null, bad)
  }
  assert.match(INVALID_CURSOR_MESSAGE, /cursor/)
})

test('필터 조건은 고른 칼럼으로 만들고 기본은 created_at 이다', () => {
  const c = { time: T2, id: uuid(1) }
  assert.equal(cursorFilter(c, 'first_seen_at'),
    `first_seen_at.lt.${T2},and(first_seen_at.eq.${T2},id.lt.${uuid(1)})`)
  assert.ok(cursorFilter(c).startsWith('created_at.lt.'))
})

test('배선: 라우트가 cursor 를 읽어 커서 넘김으로 넘기고, 질의는 id 를 둘째 정렬로 둔다', () => {
  const route = read('app', 'api', 'public', 'v1', 'ci', 'contents', 'route.ts')
  const bridge = read('lib', 'public-api', 'ci-bridge.ts')
  const contents = read('lib', 'ci', 'queries', 'contents.ts')

  assert.match(route, /readCiListCursor\(request\)/)
  assert.match(route, /keyset:\s*\{\s*after\s*\}/)
  assert.match(bridge, /searchParams\.get\('cursor'\)/)
  assert.match(bridge, /parseListCursor\(raw\)/)
  assert.match(bridge, /PublicCiInputError\) return fail\(400/)
  assert.match(contents, /order\('id', \{ ascending: false \}\)/)
  assert.match(contents, /cursorFilter\(after, 'first_seen_at'\)/)
})

test('주소에서 + 가 공백으로 바뀐 커서도 같은 커서로 읽는다', async () => {
  const { parseListCursor } = await import('./cursor.ts')
  const id = '11111111-2222-4333-8444-555555555555'
  const raw = `2026-10-01T00:00:00.123456+00:00__${id}`
  assert.deepEqual(parseListCursor(raw.replace('+', ' ')), parseListCursor(raw))
  assert.equal(parseListCursor(raw)?.time, '2026-10-01T00:00:00.123456+00:00')
})
