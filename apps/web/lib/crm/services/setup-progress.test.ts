// 시작하기 (셋업 체크리스트) + 처음 여는 사람의 동선
//
// **왜 이 가드가 있는가**: 처음 CRM 을 연 사람은 **무엇부터 해야 하는지 모른다.**
// 메뉴가 12개인데 어느 것이 "먼저"인지 아무도 알려 주지 않았다.
//
// 업계 정설은 순서가 정해져 있다 — **프로세스 → 데이터 → 운영**
// (Salesforce·TechnologyAdvice·Pipedrive 도입 가이드가 모두 같다).
// 그 순서를 화면이 말해 줘야 한다.
//
// **투어가 아니라 체크리스트인 이유**: 투어는 한 번 보고 끝나고 중간에 나가면 못 찾는다.
// 체크리스트는 상태라서 언제 돌아와도 어디까지 했는지 보인다.
//
// 실측(브라우저): "시작하기 2/4" — 회사 12곳·딜 1건은 체크됐고,
// 시드 4개가 그대로인 영업 단계와 계획 없는 딜 1건이 남은 것으로 정확히 판정됐다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSetupProgress } from './setup-progress.ts'
import { SEED_PIPELINES } from '../../../prisma/seed-data.ts'

const SRC = readFileSync(new URL('./setup-progress.ts', import.meta.url), 'utf8')
const TODAY_UI = readFileSync(
  new URL('../../../app/(crm)/crm/today/TodayClient.tsx', import.meta.url), 'utf8')
const LAYOUT = readFileSync(
  new URL('../../../app/(crm)/layout.tsx', import.meta.url), 'utf8')
const DEALS = readFileSync(
  new URL('../../../app/(crm)/crm/deals/DealsClient.tsx', import.meta.url), 'utf8')
const BOARD = readFileSync(
  new URL('../../../app/(crm)/crm/deals/DealBoard.tsx', import.meta.url), 'utf8')
const FORM = readFileSync(
  new URL('../../../app/(crm)/crm/deals/DealFormModal.tsx', import.meta.url), 'utf8')
const REPORTS = readFileSync(
  new URL('../../../app/(crm)/crm/reports/ReportsClient.tsx', import.meta.url), 'utf8')

/** 상태를 흉내 내는 가짜 DB */
function fakeDb(o: {
  pipelines?: string[]
  companies?: number
  openDeals?: number
  dealsWithTask?: number
}) {
  const open = Array.from({ length: o.openDeals ?? 0 }, (_, i) => ({ id: `d${i}` }))
  const withTask = open.slice(0, o.dealsWithTask ?? 0).map((d) => ({ dealId: d.id }))
  return {
    crmPipeline: { findMany: async () => (o.pipelines ?? []).map((name) => ({ name })) },
    crmCompany: { count: async () => o.companies ?? 0 },
    crmDeal: {
      count: async () => open.length,
      findMany: async () => open,
    },
    crmTask: { findMany: async () => withTask },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const SEED = ['GPU 인프라', '파트너십', '공공', 'KDC 제품']

test('★ 아무것도 없으면 넷 다 남는다 — 처음 온 사람이 볼 화면이다', async () => {
  const p = await buildSetupProgress(fakeDb({ pipelines: SEED }))
  assert.equal(p.doneCount, 0)
  assert.equal(p.complete, false)
  assert.equal(p.current, 'pipeline', '첫 할 일이 영업 단계가 아니다')
})

test('★ 순서가 업계 정설과 같다 — 프로세스 → 데이터 → 운영', async () => {
  const p = await buildSetupProgress(fakeDb({ pipelines: SEED }))
  assert.deepEqual(p.steps.map((s) => s.id), ['pipeline', 'company', 'deal', 'next_action'])
})

test('★ 시드 이름이 그대로면 "아직 자기 것으로 안 만들었다"로 본다', async () => {
  const p = await buildSetupProgress(fakeDb({ pipelines: SEED }))
  const step = p.steps[0]
  assert.equal(step.done, false)
  assert.match(step.status, /처음 넣어 둔 4개가 그대로/)
})

test('직접 만든 것이 하나라도 있으면 체크된다 — 손을 댄 것이 중요하다', async () => {
  const p = await buildSetupProgress(fakeDb({ pipelines: [...SEED, '우리 영업'] }))
  assert.equal(p.steps[0].done, true)
})

test('시드를 다 지웠어도 체크된다 — 지운 것도 정리한 것이다', async () => {
  const p = await buildSetupProgress(fakeDb({ pipelines: ['영업'] }))
  assert.equal(p.steps[0].done, true)
})

test('★ 사용자가 "했다"를 누르지 않아도 저절로 체크된다 — 상태로 판정한다', async () => {
  const p = await buildSetupProgress(fakeDb({ pipelines: SEED, companies: 12 }))
  assert.equal(p.steps[1].done, true)
  assert.match(p.steps[1].status, /12곳/)
})

test('★ 딜이 없으면 "다음 할 일" 단계를 미리 체크하지 않는다 — 미리 체크하면 거짓이다', async () => {
  const p = await buildSetupProgress(fakeDb({ pipelines: SEED, companies: 5, openDeals: 0 }))
  assert.equal(p.steps[3].done, false)
  assert.match(p.steps[3].status, /딜을 만들면/)
})

test('실측 재현: 회사 12·딜 1·계획 없음 1 → 2/4 (브라우저에서 본 값)', async () => {
  const p = await buildSetupProgress(fakeDb({
    pipelines: SEED, companies: 12, openDeals: 1, dealsWithTask: 0,
  }))
  assert.equal(p.doneCount, 2)
  assert.match(p.steps[3].status, /1건이 아직 안 정해졌어요/)
})

test('★ 다 끝나면 complete — 화면이 사라진다(계속 뜨면 그때부턴 장식이다)', async () => {
  const p = await buildSetupProgress(fakeDb({
    pipelines: ['우리 영업'], companies: 3, openDeals: 2, dealsWithTask: 2,
  }))
  assert.equal(p.complete, true)
  assert.equal(p.current, null)
  const route = readFileSync(
    new URL('../../../app/api/crm/today/route.ts', import.meta.url), 'utf8')
  assert.ok(route.includes('!setup.complete ? setup : null'), '끝나도 계속 보낸다')
})

test('★ 각 단계가 왜 하는지 말한다 — 이유 없는 지시는 사람이 안 따른다', async () => {
  const p = await buildSetupProgress(fakeDb({ pipelines: SEED }))
  for (const s of p.steps) {
    assert.ok(s.why.length > 10, `${s.id} 에 이유가 없다`)
    assert.ok(s.action.href.startsWith('/crm/'), `${s.id} 에 갈 곳이 없다`)
  }
})

test('★ 실패해도 화면은 산다 — 안내가 못 뜬다고 CRM 을 못 쓰면 그게 더 나쁘다', () => {
  assert.ok(SRC.includes('.catch(() => 0)'), '조회 실패를 안 잡는다')
  const route = readFileSync(
    new URL('../../../app/api/crm/today/route.ts', import.meta.url), 'utf8')
  assert.ok(route.includes('buildSetupProgress(db).catch(() => null)'), '안내 실패가 화면을 죽인다')
})

test('★ 지금 할 것 하나만 강조한다 — 넷을 다 읽게 하면 아무것도 안 한다', () => {
  assert.ok(TODAY_UI.includes("data-current="), '현재 단계를 표시하지 않는다')
  assert.ok(TODAY_UI.includes('setup.current'), '무엇이 지금인지 안 쓴다')
})

// ── 시드 축소 ──────────────────────────────────────────────

test('★ 새 워크스페이스는 파이프라인 하나로 시작한다 — 안 쓰는 것이 화면을 차지하면 안 된다', () => {
  assert.equal(SEED_PIPELINES.length, 1)
  assert.equal(SEED_PIPELINES[0].name, '영업', '특정 사업 이름은 남의 회사에 안 맞는다')
  assert.equal(SEED_PIPELINES[0].isDefault, true)
})

// ── 빈 것 접기 ─────────────────────────────────────────────

test('★ 리포트가 안 쓰는 영업 단계를 접는다 (실측: 3개 접힘)', () => {
  assert.ok(REPORTS.includes('showEmpty'), '접기 상태가 없다')
  assert.ok(REPORTS.includes('아직 안 쓰는 영업 단계'), '접었다는 사실을 안 알린다')
})

test('★ 딜 보드 선택도 접는다 — 고를 때마다 빈 보드를 만나면 안 된다', () => {
  assert.ok(BOARD.includes('optgroup'), '접은 것을 따로 묶지 않는다')
  assert.ok(BOARD.includes('아직 안 쓰는 것'), '접었다는 사실을 안 알린다')
  // 지금 보고 있는 것은 접혀도 목록에 남아야 한다 — 아니면 선택이 사라진다
  assert.ok(BOARD.includes('p.id === pipelineId ||'), '보고 있는 것이 사라질 수 있다')
})

test('접은 것을 숨기지 않는다 — 몇 개인지는 말한다', () => {
  assert.ok(/안 쓰는 영업 단계 \{unused\.length\}개/.test(REPORTS), '개수를 안 밝힌다')
})

// ── 등록 동선 ──────────────────────────────────────────────

test('★ 딜이 0건일 때 붙여넣기 입력을 펼친다 — 접혀 있으면 그게 뭔지 모르고 지나친다', () => {
  assert.ok(DEALS.includes('defaultOpen={dealCount === 0}'), '딜이 없어도 접혀 있다')
})

test('★ 회사가 없으면 그 자리에서 만든다 (실측: 만들자마자 자동 선택)', () => {
  assert.ok(FORM.includes('async function createCompany'), '인라인 생성이 없다')
  assert.ok(FORM.includes('companies.length === 0 &&'), '항상 떠서 자리를 차지한다')
  assert.ok(FORM.includes('setCompanyId(id)'), '만든 회사가 자동 선택되지 않는다')
  assert.ok(FORM.includes('isEnterKey(e)'), '한글 조합 중 엔터로 만들어진다')
})

// ── 사이드바 ───────────────────────────────────────────────

test('★ 매일 여는 순서로 정렬한다 — 오늘 → 인박스 → 딜 → 회사 → 인물', () => {
  const order = ['/crm/today', '/crm/inbox', '/crm/deals', '/crm/companies', '/crm/people']
  const idx = order.map((h) => LAYOUT.indexOf(`href: '${h}'`))
  for (let i = 1; i < idx.length; i++) {
    assert.ok(idx[i - 1] < idx[i], `${order[i - 1]} 가 ${order[i]} 뒤에 있다`)
  }
})

test('★ 딜이 회사보다 앞이다 — 영업이 하루에 가장 많이 보는 것은 딜이다', () => {
  assert.ok(LAYOUT.indexOf("href: '/crm/deals'") < LAYOUT.indexOf("href: '/crm/companies'"))
})

test('그룹 이름과 항목 이름이 겹치지 않는다 — 같은 말이 두 번 나오면 헷갈린다', () => {
  assert.ok(!LAYOUT.includes("label: '기록', icon: <History"), '"기록" 안에 "기록"이 있다')
  assert.ok(LAYOUT.includes("label: '변경 이력'"), '변경 이력으로 안 바뀌었다')
})

test('설정해야 쓰는 것은 [설정] 그룹에 모인다 — 매일 쓰는 것 사이에 끼면 못 찾는다', () => {
  const settings = LAYOUT.slice(LAYOUT.indexOf("label: '설정'"))
  for (const h of ['/crm/process', '/crm/members', '/crm/settings']) {
    assert.ok(settings.includes(`href: '${h}'`), `${h} 가 설정 그룹에 없다`)
  }
})
