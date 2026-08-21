/**
 * 축을 지정하는 커서 — 미팅 목록이 쓰는 경로
 *
 * **왜 계산으로 잠그나(E-6).** 페이징은 실데이터가 한 페이지를 넘겨야만 화면에서 밟힌다.
 * 운영 미팅이 1건뿐이라 다음 페이지가 존재하지 않았고, 그걸 만들려면 운영 DB 에
 * 검증용 행을 여러 개 넣어야 한다 — 남기지 않으려던 흔적을 남기는 셈이다.
 *
 * **실측 앵커**: 2026-08-22 /crm/meetings (격리 서버 :3111, 실사용자 세션)
 *   `GET /api/crm/meetings?limit=20` → `{ total: 1, items.length 1, nextCursor: null }`
 *   아래 첫 단정이 그 한 쌍이다. 이 앵커가 깨지면 계산이 화면에서 떠난 것이다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { cursorWhereOn, orderDescOn, toPageOn, decodeCursor } from './cursor.ts'

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `m${i}`,
  startedAt: new Date(Date.UTC(2026, 7, 20 - i, 6, 0, 0)),
}))

test('앵커: 1건 · limit 20 이면 다음 페이지가 없다 (실측 /crm/meetings v0.7.582)', () => {
  const page = toPageOn('startedAt', rows(1), 20, 1)
  assert.equal(page.items.length, 1)
  assert.equal(page.nextCursor, null)
  assert.equal(page.total, 1)
})

test('★ limit 을 넘으면 딱 limit 만 주고 커서를 만든다 — 초과분이 조용히 사라지면 안 된다', () => {
  const page = toPageOn('startedAt', rows(21), 20)
  assert.equal(page.items.length, 20)
  assert.ok(page.nextCursor)
})

test('★ 커서는 **정렬 축**의 값으로 만든다 — 축과 커서가 어긋나면 행이 통째로 건너뛰어진다', () => {
  const r = rows(3)
  const page = toPageOn('startedAt', r, 2)
  const decoded = decodeCursor(page.nextCursor)
  assert.ok(decoded)
  // 마지막으로 준 행의 startedAt·id 여야 한다(updatedAt 이 아니라)
  assert.equal(decoded.updatedAt.toISOString(), r[1].startedAt.toISOString())
  assert.equal(decoded.id, r[1].id)
})

test('이어보기 조건은 커서보다 오래된 것만 — 같은 시각이면 id 로 가른다(같은 행 두 번 방지)', () => {
  const at = new Date('2026-08-19T06:00:00.000Z')
  const w = cursorWhereOn('startedAt', { updatedAt: at, id: 'm1' }) as { OR: Record<string, unknown>[] }
  assert.deepEqual(w.OR[0], { startedAt: { lt: at } })
  assert.deepEqual(w.OR[1], { startedAt: at, id: { lt: 'm1' } })
})

test('커서가 없으면 조건도 없다 — 첫 페이지는 아무것도 자르지 않는다', () => {
  assert.equal(cursorWhereOn('startedAt', null), undefined)
})

test('정렬은 지정한 축 우선, 동점은 id — 순서가 흔들리면 페이지 경계가 흔들린다', () => {
  assert.deepEqual(orderDescOn('startedAt'), [{ startedAt: 'desc' }, { id: 'desc' }])
})

test('기존 updatedAt 경로는 한 글자도 안 바뀐다 — 다른 목록이 이 변경에 영향받지 않는다', () => {
  const page = toPageOn('updatedAt', [
    { id: 'a', updatedAt: new Date('2026-08-20T00:00:00.000Z') },
    { id: 'b', updatedAt: new Date('2026-08-19T00:00:00.000Z') },
  ], 1)
  assert.equal(page.nextCursor, '2026-08-20T00:00:00.000Z|a')
})
