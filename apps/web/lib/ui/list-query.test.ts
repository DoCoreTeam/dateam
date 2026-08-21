// lib/ui/list-query.test.ts — 목록 상태 계약 가드
// 우선순위(URL > 저장 > 기본)와 "필터는 저장하지 않는다"가 이 파일의 핵심이다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveListQuery, listQueryToParams, savedFromQuery, sanitizeSavedPrefs,
  shouldResetPage, clampSize, rangeOf, pageCount, pageWindow,
  type ListDefaults,
} from './list-query.ts'

const DEFAULTS: ListDefaults = {
  sort: { key: 'created_at', dir: 'desc' },
  view: 'table',
  size: 20,
  filterKeys: ['status', 'owner'],
}

test('우선순위: URL이 저장 설정과 화면 기본값을 이긴다', () => {
  const q = resolveListQuery(
    new URLSearchParams('view=card&size=50&sort=name&dir=asc'),
    DEFAULTS,
    { view: 'compact', size: 100, sort: { key: 'updated_at', dir: 'desc' } },
  )
  assert.equal(q.view, 'card')
  assert.equal(q.size, 50)
  assert.deepEqual(q.sort, { key: 'name', dir: 'asc' })
})

test('우선순위: URL이 없으면 저장 설정이 화면 기본값을 이긴다', () => {
  const q = resolveListQuery(new URLSearchParams(''), DEFAULTS, { view: 'card', size: 100 })
  assert.equal(q.view, 'card')
  assert.equal(q.size, 100)
  assert.deepEqual(q.sort, DEFAULTS.sort, '저장된 정렬이 없으면 화면 기본 정렬')
})

test('우선순위: 둘 다 없으면 화면 기본값', () => {
  const q = resolveListQuery(new URLSearchParams(''), DEFAULTS, null)
  assert.equal(q.view, 'table')
  assert.equal(q.size, 20)
  assert.equal(q.page, 1)
  assert.equal(q.mode, 'pages', '기본은 페이지 — 누적은 DOM이 자란다')
})

test('필터는 화면이 선언한 키만 받는다 (URL 오염 차단)', () => {
  const q = resolveListQuery(
    new URLSearchParams('status=open&owner=u1&evil=1'),
    DEFAULTS,
  )
  assert.deepEqual(q.filters, { status: 'open', owner: 'u1' })
})

test('보기·개수는 화이트리스트 밖 값을 무시한다', () => {
  const q = resolveListQuery(new URLSearchParams('view=hologram&size=9999'), DEFAULTS)
  assert.equal(q.view, 'table')
  assert.equal(q.size, 20)
  assert.equal(clampSize('50'), 50)
  assert.equal(clampSize(37), undefined)
})

test('page는 1 미만·비정상 입력을 1로 접는다', () => {
  assert.equal(resolveListQuery(new URLSearchParams('page=0'), DEFAULTS).page, 1)
  assert.equal(resolveListQuery(new URLSearchParams('page=-3'), DEFAULTS).page, 1)
  assert.equal(resolveListQuery(new URLSearchParams('page=abc'), DEFAULTS).page, 1)
  assert.equal(resolveListQuery(new URLSearchParams('page=4'), DEFAULTS).page, 4)
})

test('URL 직렬화: 기본값과 같은 값은 주소에 남기지 않는다', () => {
  const q = resolveListQuery(new URLSearchParams(''), DEFAULTS)
  assert.equal(listQueryToParams(q, DEFAULTS).toString(), '')
})

test('URL 직렬화: 바뀐 것만, 필터·검색어는 그대로 실린다', () => {
  const q = resolveListQuery(new URLSearchParams('q=김&status=open&view=card&page=3'), DEFAULTS)
  const p = listQueryToParams(q, DEFAULTS)
  assert.equal(p.get('q'), '김')
  assert.equal(p.get('status'), 'open')
  assert.equal(p.get('view'), 'card')
  assert.equal(p.get('page'), '3')
  assert.equal(p.get('size'), null)
})

test('저장 대상은 view·size·sort뿐 — 필터·검색어·페이지는 저장하지 않는다', () => {
  const q = resolveListQuery(new URLSearchParams('q=김&status=open&page=5&view=card'), DEFAULTS)
  const saved = savedFromQuery(q)
  assert.deepEqual(Object.keys(saved).sort(), ['size', 'sort', 'view'])
  assert.equal(JSON.stringify(saved).includes('open'), false)
})

test('저장값 위생: 손상·옛 스키마는 화면에 들이지 않는다', () => {
  assert.deepEqual(sanitizeSavedPrefs(null), {})
  assert.deepEqual(sanitizeSavedPrefs('table'), {})
  assert.deepEqual(sanitizeSavedPrefs({ view: 'hologram', size: 7, sort: { key: '', dir: 'up' } }), {})
  assert.deepEqual(
    sanitizeSavedPrefs({ view: 'card', size: 50, sort: { key: 'name', dir: 'asc' }, filters: { s: 'x' } }),
    { view: 'card', size: 50, sort: { key: 'name', dir: 'asc' } },
  )
})

test('조건이 바뀌면 1페이지로 — 3페이지에서 검색하면 빈 화면이 된다', () => {
  assert.equal(shouldResetPage({ q: '김' }), true)
  assert.equal(shouldResetPage({ sort: { key: 'name', dir: 'asc' } }), true)
  assert.equal(shouldResetPage({ filters: { status: 'open' } }), true)
  assert.equal(shouldResetPage({ size: 50 }), true)
  assert.equal(shouldResetPage({ view: 'card' }), false, '보기 전환은 위치를 유지한다')
  assert.equal(shouldResetPage({ page: 2 }), false)
})

test('rangeOf: pages는 해당 페이지 구간, more는 처음부터 누적', () => {
  const base = resolveListQuery(new URLSearchParams('page=3'), DEFAULTS)
  assert.deepEqual(rangeOf(base), { from: 40, to: 59 })
  const more = resolveListQuery(new URLSearchParams('page=3'), { ...DEFAULTS, mode: 'more' })
  assert.deepEqual(rangeOf(more), { from: 0, to: 59 })
})

test('pageCount: 0건·나누어떨어지지 않는 수', () => {
  assert.equal(pageCount(0, 20), 1)
  assert.equal(pageCount(20, 20), 1)
  assert.equal(pageCount(21, 20), 2)
  assert.equal(pageCount(-5, 20), 1)
})

test('pageWindow: 100페이지를 다 그리지 않고 현재 주변만', () => {
  assert.deepEqual(pageWindow(1, 100), [1, 2, 3, 4, 5])
  assert.deepEqual(pageWindow(50, 100), [48, 49, 50, 51, 52])
  assert.deepEqual(pageWindow(100, 100), [96, 97, 98, 99, 100])
  assert.deepEqual(pageWindow(2, 3), [1, 2, 3], '총 페이지가 창보다 적으면 전부')
})

test('주소를 다시 쓸 때 목록이 소유하지 않은 파라미터를 지우지 않는다', () => {
  // 왜 중요한가: 탭·드로어 같은 **화면의 다른 상태**가 같은 주소에 함께 산다.
  // 목록이 주소를 통째로 새로 쓰면 필터를 한 번 건드리는 순간 그 상태가 사라져
  // 엉뚱한 탭으로 튕긴다. 그게 화면들이 이 표준을 안 쓰고 URL 동기화를 자작한 이유였다.
  const current = new URLSearchParams('tab=list&detail=abc&status=old&q=이전')
  const q = resolveListQuery(current, DEFAULTS)
  const out = listQueryToParams({ ...q, q: '새검색' }, DEFAULTS, current)

  assert.equal(out.get('tab'), 'list', '남의 파라미터는 보존')
  assert.equal(out.get('detail'), 'abc', '남의 파라미터는 보존')
  assert.equal(out.get('q'), '새검색', '목록 소유 파라미터는 새 값이 이긴다')
  assert.equal(out.get('status'), 'old', '선언된 필터는 목록 소유 — 쿼리 값이 남는다')
})

test('보존 인자를 안 주면 목록 파라미터만 남는다(구 동작 유지)', () => {
  const current = new URLSearchParams('tab=list')
  const q = resolveListQuery(current, DEFAULTS)
  assert.equal(listQueryToParams(q, DEFAULTS).get('tab'), null)
})

// ── "기본값으로 되돌리기"가 조용히 죽던 구멍 (v0.7.574) ──────────────────
//
// 실측: 회사 목록에서 '더 보기'로 60행을 쌓은 뒤 "20개씩"(=기본값)을 고르면
// 행 수가 **60 그대로**였다. 아래 두 테스트가 그 원인을 코드로 증명하고,
// 세 번째가 훅이 실제로 그것을 메우는지 확인한다.

test('기본값과 같은 값을 고르면 주소가 한 글자도 안 바뀐다 — 이것이 원인이다', () => {
  const base = { ...resolveListQuery(new URLSearchParams(''), DEFAULTS) }
  // 사용자가 "20개씩"(기본값)을 고른 상태
  const picked = { ...base, size: 20 as const }
  assert.equal(
    listQueryToParams(picked, DEFAULTS).toString(),
    listQueryToParams(base, DEFAULTS).toString(),
    '주소가 같으면 searchParams 가 안 바뀌고 화면은 아무 일도 없었다고 읽는다',
  )
})

test('기본값이 아닌 값은 주소가 바뀐다 — 그래서 이 구멍이 오래 안 보였다', () => {
  const base = resolveListQuery(new URLSearchParams(''), DEFAULTS)
  const picked = { ...base, size: 100 as const }
  assert.notEqual(
    listQueryToParams(picked, DEFAULTS).toString(),
    listQueryToParams(base, DEFAULTS).toString(),
  )
})

test('훅이 그 구멍을 메운다 — 주소가 같을 때만 리비전을 올리고 queryKey 로 내보낸다', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('./use-list-query.ts', import.meta.url), 'utf8')

  // 양쪽을 같은 함수로 만들어 비교해야 한다 — 주소 순서로 비교하면 오판한다
  assert.match(src, /const nextParams = listQueryToParams\(next, defaults\)\.toString\(\)/)
  assert.match(src, /const nowParams = listQueryToParams\(query, defaults\)\.toString\(\)/)
  assert.match(src, /if \(nextParams === nowParams\) setRevision/)

  // 화면이 쓸 의존성 하나로 나가야 한다 — 안 나가면 훅만 알고 화면은 모른다
  assert.match(src, /queryKey/)
  assert.match(src, /return \{ query, set, queryKey \}/)
})

test('목록 화면은 조건 의존성을 queryKey 로 받는다 — 개별 필드 나열은 빠뜨린다', async () => {
  const { readFileSync } = await import('node:fs')
  const view = readFileSync(
    new URL('../../app/(crm)/crm/companies/CompanyListView.tsx', import.meta.url), 'utf8')
  assert.match(view, /useListQuery\(/)
  assert.ok(view.includes('queryKey'), '조회 콜백이 queryKey 를 의존성으로 받아야 한다')
})
