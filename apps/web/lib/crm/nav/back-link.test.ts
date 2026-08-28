import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backTarget, linkWithBack } from './back-link.ts'

const params = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null })
const FALLBACK = { href: '/crm/deals', label: '딜 목록' }

test('돌아갈 곳이 없으면 목록으로 — 화면이 이름을 지어내지 않는다', () => {
  assert.deepEqual(backTarget(params({}), FALLBACK), FALLBACK)
})

test('실려 온 곳이 있으면 그리로 가고, 이름도 함께 온다', () => {
  const t = backTarget(params({ returnTo: '/crm/deals/abc', returnLabel: '수원시청' }), FALLBACK)
  assert.deepEqual(t, { href: '/crm/deals/abc', label: '수원시청' })
})

test('이름이 없으면 「돌아가기」 — 빈 이름을 그리지 않는다', () => {
  const t = backTarget(params({ returnTo: '/crm/deals/abc' }), FALLBACK)
  assert.equal(t.label, '돌아가기')
})

test('★ 바깥 주소로는 안 보낸다 — 열린 리다이렉트 차단', () => {
  for (const bad of ['https://evil.example.com', '//evil.example.com', '/\\evil', 'http://x.kr/a']) {
    const t = backTarget(params({ returnTo: bad }), FALLBACK)
    assert.deepEqual(t, FALLBACK, `${bad} 가 통과했다`)
  }
})

test('개행이 섞인 주소도 막는다 — 헤더 분리 공격', () => {
  const t = backTarget(params({ returnTo: '/crm/a\r\nSet-Cookie: x=1' }), FALLBACK)
  assert.deepEqual(t, FALLBACK)
})

test('링크에 «여기»와 이름을 함께 싣는다', () => {
  const href = linkWithBack('/crm/companies/c1', { path: '/crm/deals/d1?tab=x', label: '수원시청' })
  assert.ok(href.startsWith('/crm/companies/c1?'))
  assert.ok(href.includes('returnTo='))
  assert.ok(href.includes('returnLabel='))
  // 원래 쿼리(탭·필터)가 살아 있어야 돌아갔을 때 같은 화면이다
  assert.ok(decodeURIComponent(href).includes('/crm/deals/d1?tab=x'))
})

test('이미 쿼리가 있는 주소에도 붙는다 — ? 가 두 번 들어가지 않는다', () => {
  const href = linkWithBack('/crm/companies/c1?view=x', { path: '/crm/deals/d1', label: 'A' })
  assert.equal((href.match(/\?/g) ?? []).length, 1)
})
