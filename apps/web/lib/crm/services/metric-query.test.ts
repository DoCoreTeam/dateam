// lib/crm/services/metric-query.test.ts — 로더는 얇고, 화면에 실제로 꽂혀 있다
//
// **왜 배선까지 보나**: 이 저장소는 「만들고 안 꽂으면 없는 기능이다」를 여러 번 겪었다
// (v0.7.438 `/ci` — 테이블·설정은 만들었는데 소비 코드가 0이라 화면에선 아무 일도
// 안 일어났다). 그래서 서비스 가드는 계산뿐 아니라 **불리는지**까지 본다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadDealsForMetrics, runMetrics, dimensionFill, DEAL_SCAN_LIMIT } from './metric-query.ts'
import { sumOf, EMPTY_KEY } from '../domain/metric-agg.ts'

const SRC = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

function fakeDb(deals: unknown[], biz: unknown[] = []) {
  return {
    crmDeal: { findMany: async () => deals },
    crmBusinessTypeOption: { findMany: async () => biz },
  } as never
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'd1', status: 'OPEN',
  createdAt: new Date('2026-06-01T00:00:00Z'),
  wonAt: null, expectedCloseDate: new Date('2026-10-01T00:00:00Z'),
  startDate: null, endDate: null, currency: 'KRW',
  contractNetMinor: null, quotedNetMinor: null, budgetNetMinor: null,
  amountMinor: BigInt('100000000'),
  businessTypeKey: null, ownerId: null,
  stage: { id: 'st1', name: '진행 중', winProbabilityPct: 33 },
  pipeline: { id: 'p1', name: '흐름ㄱ' },
  owner: null,
  company: { id: 'c1', name: '고객ㄱ', industry: null, region: null, employeeRange: null, domain: null },
  history: [],
  ...over,
})

test('★ 단계 진입 시각은 마지막 이동이고, 이동한 적이 없으면 만든 날이다', async () => {
  const moved = await loadDealsForMetrics(fakeDb([
    row({ id: 'a', history: [{ movedAt: new Date('2026-08-20T00:00:00Z') }] }),
    row({ id: 'b', history: [] }),
  ]))
  assert.equal(moved.deals[0].stageEnteredAtIso, '2026-08-20T00:00:00.000Z')
  assert.equal(moved.deals[1].stageEnteredAtIso, '2026-06-01T00:00:00.000Z',
    '첫 단계에는 만들어진 순간부터 있었던 것이 사실이다')
})

test('★ 단계 확률이 없으면 null 이다 — 0 으로 접으면 가중 예상이 조용히 줄어든다', async () => {
  const r = await loadDealsForMetrics(fakeDb([
    row({ id: 'a', stage: { id: 's', name: 'x', winProbabilityPct: null } }),
    row({ id: 'b', stage: null }),
  ]))
  assert.equal(r.deals[0].winProbabilityPct, null)
  assert.equal(r.deals[1].winProbabilityPct, null)
})

test('확률 0 은 값이다 — null 로 접지 않는다', async () => {
  const r = await loadDealsForMetrics(fakeDb([row({ stage: { id: 's', name: 'x', winProbabilityPct: 0 } })]))
  assert.equal(r.deals[0].winProbabilityPct, 0)
})

test('사업 유형은 키가 아니라 이름으로 나간다 — 축에 영문 키가 찍히면 안 된다', async () => {
  const r = await loadDealsForMetrics(
    fakeDb([row({ businessTypeKey: 'SOLUTION' })], [{ key: 'SOLUTION', label: '솔루션' }]))
  assert.deepEqual(r.deals[0].businessType, { id: 'SOLUTION', name: '솔루션' })
})

test('이름을 모르는 유형은 키를 그대로 보여 준다 — 빈칸으로 만들지 않는다', async () => {
  const r = await loadDealsForMetrics(fakeDb([row({ businessTypeKey: 'X' })], []))
  assert.equal(r.deals[0].businessType?.name, 'X')
})

test('★ 상한을 넘으면 잘랐다고 말한다 — 조용히 자르면 「이게 전부」로 읽고 보고에 쓴다', async () => {
  const many = Array.from({ length: DEAL_SCAN_LIMIT + 1 }, (_, i) => row({ id: `d${i}` }))
  const r = await loadDealsForMetrics(fakeDb(many))
  assert.equal(r.truncated, true)
  assert.equal(r.deals.length, DEAL_SCAN_LIMIT)
})

test('상한 안이면 안 잘랐다고 한다', async () => {
  const r = await loadDealsForMetrics(fakeDb([row()]))
  assert.equal(r.truncated, false)
})

test('검증용 파이프라인 이름을 화면에 알린다 — 딜은 숨기지 않는다', async () => {
  const r = await loadDealsForMetrics(fakeDb([
    row({ id: 'a', pipeline: { id: 'p9', name: '__검증' } }),
    row({ id: 'b' }),
  ]))
  assert.deepEqual(r.hiddenPipelines, ['__검증'])
  assert.equal(r.deals.length, 2, '숨기면 합이 조용히 줄어든다')
})

test('★ 지표 여럿을 같은 딜 배열 위에서 돌린다 — 카드가 같은 시점을 말한다', async () => {
  const loaded = await loadDealsForMetrics(fakeDb([row({ amountMinor: BigInt('100000000') })]))
  const base = { period: { kind: 'YEAR' as const, year: 2026 }, todayKey: '2026-09-09' }
  const [open, weighted] = runMetrics(loaded, [
    { ...base, metric: 'open_pipeline' },
    { ...base, metric: 'weighted' },
  ])
  assert.equal(sumOf(open.total), BigInt('100000000'))
  assert.equal(sumOf(weighted.total), BigInt('33000000'), '같은 딜에 33% 를 곱한 값')
})

test('축 채움을 센다 — 「없음 한 줄」을 데이터 없음으로 읽지 않게', async () => {
  const c = (industry: string | null) => ({ id: 'c', name: 'x', industry, region: null, employeeRange: null, domain: null })
  const loaded = await loadDealsForMetrics(fakeDb([
    row({ id: 'a', company: c('제조') }),
    row({ id: 'b', company: c(null) }),
    row({ id: 'c', company: c(null) }),
  ]))
  assert.deepEqual(dimensionFill(loaded, 'industry'), { filled: 1, total: 3 })
})

test('축 채움 판정은 엔진의 판정을 그대로 쓴다 — 다시 짜면 화면과 어긋난다', () => {
  const src = SRC('./metric-query.ts')
  assert.ok(src.includes('bucketOf('), '엔진의 bucketOf 로 판정해야 한다')
  assert.ok(src.includes('EMPTY_KEY'), `빈 칸 이름을 문자열로 다시 적으면 안 된다(${EMPTY_KEY})`)
})

// ── 배선 ────────────────────────────────────────────────
test('★ 로더는 계산을 다시 짜지 않는다 — 집계는 순수 엔진 하나뿐이다', () => {
  const src = SRC('./metric-query.ts')
  assert.ok(src.includes("from '../domain/metric-agg.ts'"), '엔진을 import 해야 한다')
  for (const banned of ['winProbabilityPct / 100', 'reduce((', 'groupBy:']) {
    assert.ok(!src.includes(banned), `로더가 집계를 다시 짠다: ${banned}`)
  }
})

test('★ 라우트가 서비스를 실제로 부른다 — 만들고 안 꽂으면 없는 기능이다', () => {
  // import 줄을 떼고 본다 — 「가져오기만 하고 안 쓰는」 것이 바로 이 사고의 모양이다
  const body = SRC('../../../app/api/crm/metrics/route.ts')
    .split('\n').filter((l) => !/^\s*(import|\s*[\w,{}* ]+ from )/.test(l)).join('\n')
  for (const fn of ['loadDealsForMetrics', 'runMetrics', 'loadTargets', 'saveTargets', 'dimensionFill']) {
    assert.ok(body.includes(`${fn}(`), `라우트가 ${fn} 을 안 부른다`)
  }
  // 화면이 그리는 것마다 실제로 값이 채워지는지 — 빈 배열을 내려보내면 카드가 영영 빈다
  assert.match(body, /const cards = runMetrics\(/, '카드를 엔진으로 만들지 않는다')
  assert.match(body, /matrix = metric \? runMetrics\(/, '교차표를 엔진으로 만들지 않는다')
  assert.ok(!/cards: never\[\]|cards = \[\]/.test(body), '카드가 빈 배열로 나간다')
})

test('★ 라우트가 한 번에 준다 — 카드가 아홉 시점을 나란히 놓지 않게', () => {
  const route = SRC('../../../app/api/crm/metrics/route.ts')
  assert.equal((route.match(/loadDealsForMetrics\(/g) ?? []).length, 1, '딜은 한 번만 읽는다')
  assert.ok(route.includes('cards') && route.includes('matrix'), '카드와 교차표가 같은 응답에 있다')
})

test('★ 모르는 값에 500 을 주지 않는다 — 주소를 손으로 고친 사람도 화면을 본다', () => {
  const route = SRC('../../../app/api/crm/metrics/route.ts')
  assert.ok(route.includes('parsePeriodKey('), '기간은 못 읽으면 기본값이다')
  assert.ok(route.includes('isKnownMetric('), '모르는 지표는 버린다')
  assert.ok(route.includes('isKnownDimension('), '모르는 축은 버린다')
})

test('★ 목표 저장은 관리자만 — 화면에서만 숨기면 API 로 새어 나간다', () => {
  const route = SRC('../../../app/api/crm/metrics/route.ts')
  assert.match(route, /export async function PUT[\s\S]*?withCrmApi\('ADMIN'/, 'PUT 이 ADMIN 게이트를 안 탄다')
  assert.match(route, /export async function GET[\s\S]*?withCrmApi\('READONLY'/, 'GET 은 읽기 권한이면 된다')
})

test('★ 목표는 새 표를 만들지 않는다 — 마이그레이션 없이 간다', () => {
  const store = SRC('./target-store.ts')
  assert.ok(store.includes('crmAppSetting'), '이미 있는 설정 표를 쓴다')
  assert.ok(!/prisma\/migrations|CREATE TABLE/i.test(store))
})

test('목표가 바뀌면 기록에 남는다 — 지난 달성률의 뜻이 함께 바뀐다', () => {
  const store = SRC('./target-store.ts')
  assert.ok(store.includes('writeAudit('), '감사 기록이 없으면 누가 바꿨는지 못 댄다')
  assert.ok(store.includes('beforeJson') && store.includes('afterJson'))
})

test('★ 목표 읽기는 던지지 않는다 — 못 읽었다고 리포트가 통째로 안 뜨면 더 큰 사고다', () => {
  const store = SRC('./target-store.ts')
  assert.match(store, /export async function loadTargets[\s\S]*?catch/, 'loadTargets 에 방어가 없다')
})

test('★ 목표 저장은 조용히 버리지 않는다 — 사라지면 「저장했는데 없다」가 된다', () => {
  const store = SRC('./target-store.ts')
  assert.match(store, /export async function saveTargets[\s\S]*?validateTargets\(raw\)/,
    'saveTargets 가 검증을 거치지 않는다')
})
