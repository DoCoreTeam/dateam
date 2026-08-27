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
import { CRM_NAV_GROUPS, CRM_ACCOUNT_ITEMS } from '../nav/groups.ts'
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

/*
 * 사이드바는 v0.7.625 부터 **묶음 다섯**이다(13개 → 5개).
 * 정의는 `lib/crm/nav/groups.ts`(SSOT)에 있고 layout 은 그림만 그린다 —
 * 그래서 여기서 layout 문자열을 뒤지는 대신 **SSOT 를 직접 단정**한다.
 * 묶음 계약 자체(고아 화면 없음·중복 없음)는 `lib/crm/nav/groups.test.ts` 가 본다.
 */
test('★ 매일 여는 순서로 정렬한다 — 오늘 → 딜 → 거래처 → 기록 → 리포트', () => {
  assert.deepEqual(
    CRM_NAV_GROUPS.map((g) => g.label),
    ['오늘', '딜', '거래처', '기록', '리포트'],
    '데이터 모델 순서가 아니라 하루에 여는 횟수 순서다',
  )
})

test('★ 딜이 거래처보다 앞이다 — 영업이 하루에 가장 많이 보는 것은 딜이다', () => {
  const labels = CRM_NAV_GROUPS.map((g) => g.label)
  assert.ok(labels.indexOf('딜') < labels.indexOf('거래처'))
})

test('★ 인박스는 「오늘」에 흡수됐다 — 따로 두면 안 열어 보고 제안이 만료된다', () => {
  const today = CRM_NAV_GROUPS.find((g) => g.label === '오늘')
  assert.ok(today?.tabs.some((t) => t.href === '/crm/inbox'), '인박스가 오늘 묶음에 없다')
  // 배지도 함께 옮겨져야 한다 — 안 옮기면 배지가 갈 곳이 없어 조용히 사라진다
  assert.ok(LAYOUT.includes("it.href === '/crm/today' && pendingInbox > 0"),
    '인박스 배지가 「오늘」로 안 옮겨졌다')
})

test('그룹 이름과 항목 이름이 겹치지 않는다 — 같은 말이 두 번 나오면 헷갈린다', () => {
  /*
   * **대표 탭(첫 탭)은 묶음과 같은 이름이 맞다.** 「딜」을 누르면 「딜 | 견적」이 뜨는 것이고,
   * 이때 첫 탭이 「딜」이 아니면 오히려 어디에 있는지 알 수 없다.
   * 막아야 하는 것은 **대표가 아닌 탭**이 묶음 이름을 또 쓰는 경우다 —
   * 예전에 「기록」 묶음 안에 「기록」 항목이 있어 같은 말이 두 번 나왔다.
   */
  for (const g of CRM_NAV_GROUPS) {
    const rest = g.tabs.slice(1)
    assert.ok(!rest.some((t) => t.label === g.label),
      `「${g.label}」 안에 같은 이름의 항목이 또 있다`)
  }
})

test('설정해야 쓰는 것은 계정 메뉴로 내려갔다 — 매일 쓰는 것 사이에 끼면 못 찾는다', () => {
  const hrefs = CRM_ACCOUNT_ITEMS.map((i) => i.href)
  for (const h of ['/crm/process', '/crm/members', '/crm/settings']) {
    assert.ok(hrefs.includes(h), `${h} 가 계정 메뉴에 없다`)
  }
  // 셸까지 실제로 연결됐는지 — 상수만 만들고 안 넘기면 화면에선 사라진 것과 같다
  assert.ok(LAYOUT.includes('settings={{ label:'), 'layout 이 settings 를 셸에 안 넘긴다')
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

test('★ 최상위는 매일 여는 다섯뿐이다 — 늘어설수록 매일 여는 것이 눈에 안 들어온다', () => {
  assert.equal(CRM_NAV_GROUPS.length, 5, '최상위가 늘었다 — 연관 있는 것은 묶음 안 탭으로 내린다')
  // 예전엔 13개였다. 실측(2026-08-27) 그중 딜·견적·할 일이 0건이라,
  // 매일 여는 것과 아직 비어 있는 것이 같은 무게로 늘어서 있었다.
  const all = CRM_NAV_GROUPS.flatMap((g) => g.tabs.length)
  assert.ok(all.reduce((a, b) => a + b, 0) >= 10, '화면을 없앤 게 아니라 탭으로 내린 것이다')
})

test('★ 회사와 인물은 [거래처] 한 묶음이다 — 늘 함께 보는 것을 따로 세우지 않는다', () => {
  const g = CRM_NAV_GROUPS.find((x) => x.label === '거래처')
  const hrefs = g?.tabs.map((t) => t.href) ?? []
  for (const h of ['/crm/companies', '/crm/people']) {
    assert.ok(hrefs.includes(h), `${h} 가 거래처 묶음에 없다`)
  }
})

test('★ 견적은 [딜] 묶음이다 — 견적은 딜 금액의 근거 문서다', () => {
  const g = CRM_NAV_GROUPS.find((x) => x.label === '딜')
  assert.ok(g?.tabs.some((t) => t.href === '/crm/quotes'), '견적이 딜 묶음에 없다')
})

test('묶음 이름은 용어집이 정한 그대로다 — 「거래처」는 메뉴 이름, 「회사」는 개체 이름', () => {
  const g = CRM_NAV_GROUPS.find((x) => x.label === '거래처')
  assert.ok(g, '묶음 이름이 다르다')
  assert.ok(g!.tabs.some((t) => t.label === '회사'), '개체 이름을 묶음 이름으로 바꿔 버렸다')
  assert.equal(ENTITY.company.label, '회사')
})

// ── 실화면에서 잡힌 것 (v0.7.614 브라우저 검증) ───────────

test('★ 할 일을 지울 길이 있다 — DELETE API 는 있는데 화면이 안 불렀다(§2-5(3))', () => {
  const TASKS = readFileSync(
    new URL('../../../app/(crm)/crm/tasks/TasksClient.tsx', import.meta.url), 'utf8')
  assert.match(TASKS, /method: 'DELETE'/, '삭제를 부르지 않는다 — 잘못 만든 것이 영원히 남는다')
  assert.match(TASKS, /confirmDelete\('task'/, '확인 없이 지운다')
  assert.match(TASKS, /aria-label=\{`\$\{t\.title\} \$\{ACTION\.delete\}`\}/,
    '어느 할 일을 지우는지 낭독기가 말하지 못한다')
})

test('같은 오류를 화면이 두 번 말하지 않는다 — 배너와 빈 상태가 동시에 떴다', () => {
  const TASKS = readFileSync(
    new URL('../../../app/(crm)/crm/tasks/TasksClient.tsx', import.meta.url), 'utf8')
  assert.ok(!/ErrorState message=\{error\}/.test(TASKS), '오류를 두 곳에서 그린다')
  assert.match(TASKS, /FormErrorBanner message=\{error\}/, '오류를 아예 안 보여 준다')
})
