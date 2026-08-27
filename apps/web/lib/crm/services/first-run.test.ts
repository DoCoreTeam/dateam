/**
 * 처음 온 사람이 막히지 않게 — 빈 상태·메뉴·접기 계약
 *
 * 예전 이 파일은 「시작하기」 진행 카드를 지켰다. 그 카드는 걷어냈다
 * (사용자 지적 2026-08-27: *"시작하기는 필요없을것 같군"*) — 한 번 하고 끝나는 안내가
 * 첫 화면 맨 위에 상주하면 그때부터 장식이고, 정작 오늘 할 일이 아래로 밀린다.
 *
 * 남은 것은 그 카드와 **무관하게 성립하는** 계약들이다 —
 *   · 처음엔 파이프라인 하나로 시작한다(안 쓰는 것이 화면을 차지하지 않게)
 *   · 안 쓰는 단계는 리포트·보드에서 접되, 몇 개 접었는지는 말한다
 *   · 딜이 0건이면 붙여넣기 입력을 펼친다
 *   · 찾는 회사가 없으면 그 자리에서 만든다
 *   · 사이드바는 매일 여는 순서다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { SEED_PIPELINES } from '../../../prisma/seed-data.ts'
import { ENTITY } from '../../terms/index.ts'

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
const PICKER = readFileSync(
  new URL('../../../components/ui/RecordPicker.tsx', import.meta.url), 'utf8')

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

test('★ 찾는 회사가 없으면 그 자리에서 만든다 (실측: 만들자마자 자동 선택)', () => {
  // 예전엔 회사가 **0개일 때만** 만들기 줄이 보였다 — 1개라도 있으면 새 회사를 넣을 길이 없었다.
  // 지금은 고르기 모달이 언제나 만들기를 들고 있다. 그래서 판정도 그 자리로 옮긴다.
  assert.ok(FORM.includes('const createCompany'), '인라인 생성이 없다')
  assert.ok(FORM.includes('onCreate={createCompany}'), '만들기가 고르기 칸에 연결되지 않았다')
  assert.ok(PICKER.includes('onPick(made)'), '만든 것이 자동 선택되지 않는다')
  assert.ok(PICKER.includes('isEnterKey(e)'), '한글 조합 중 엔터로 만들어진다')
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

// ── 상주하지 않는 안내 ─────────────────────────────────────
//
// 사용자 지적 두 건이 같은 것을 말했다 —
//   *"시작하기는 필요없을것 같군"*
//   *"옛리드도 계속 있는건 아니니깐 안맞는거지 — 일시적인게 아니라 항상 있는거 같자나"*
// **한 번 하고 끝나는 일은 끝나면 화면에서 사라져야 한다.** 남아 있으면 장식이 되고,
// 장식이 위에 있으면 정작 오늘 할 일이 아래로 밀린다.

test('★ 「시작하기」 진행 카드가 되살아나지 않는다', () => {
  assert.ok(!TODAY_UI.includes('시작하기'), '첫 화면에 시작하기가 되돌아왔다')
  assert.ok(
    !existsSync(new URL('./setup-progress.ts', import.meta.url)),
    '서비스가 되살아났다 — 다시 화면에 붙을 길이 열린다',
  )
})

test('★ 옛 리드 카드는 남은 게 없으면 그리지 않는다 — 이관이 끝나면 저절로 사라진다', () => {
  const LEAD = readFileSync(
    new URL('../../../app/(crm)/crm/inbox/LeadImport.tsx', import.meta.url), 'utf8')
  assert.match(LEAD, /if \(!counted \|\| \(pending === 0 && !open\)\) return null/,
    '다 옮긴 뒤에도 카드가 남는다')
})

test('★ 펼치지 않아도 한 번은 세어 본다 — 예전엔 뱃지가 영원히 「세는 중…」이었다', () => {
  const LEAD = readFileSync(
    new URL('../../../app/(crm)/crm/inbox/LeadImport.tsx', import.meta.url), 'utf8')
  assert.match(LEAD, /const \[counted, setCounted\] = useState\(false\)/, '센 적이 있는지를 모른다')
  assert.ok(!/'세는 중…'/.test(LEAD), '아직도 「세는 중…」을 띄운다')
})

test('★ 최상위는 매일 여는 넷뿐이다 — 늘어설수록 매일 여는 것이 눈에 안 들어온다', () => {
  const top = LAYOUT.slice(LAYOUT.indexOf('const NAV_ITEMS = ['), LAYOUT.indexOf('const NAV_GROUPS'))
  const hrefs = [...top.matchAll(/href: '([^']+)'/g)].map((m) => m[1])
  assert.deepEqual(hrefs, ['/crm/today', '/crm/inbox', '/crm/deals', '/crm/quotes'],
    '최상위가 늘었다 — 연관 있는 것은 그룹으로 묶는다')
})

test('★ 회사와 인물은 [거래처] 한 묶음이다 — 늘 함께 보는 것을 따로 세우지 않는다', () => {
  const group = LAYOUT.slice(LAYOUT.indexOf("label: '거래처'"), LAYOUT.indexOf("label: '기록'"))
  for (const h of ['/crm/companies', '/crm/people']) {
    assert.ok(group.includes(`href: '${h}'`), `${h} 가 거래처 묶음에 없다`)
  }
})

test('묶음 이름은 용어집이 정한 그대로다 — 「거래처」는 메뉴 이름, 「회사」는 개체 이름', () => {
  assert.ok(LAYOUT.includes("label: '거래처'"), '묶음 이름이 다르다')
  assert.ok(LAYOUT.includes("label: '회사'"), '개체 이름을 묶음 이름으로 바꿔 버렸다')
  assert.equal(ENTITY.company.label, '회사')
})
