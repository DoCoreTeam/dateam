// lib/ui/list-standard.test.ts — 목록 화면 표준 가드 (02-SYSTEM §6)
//
// 왜: 목록을 그리는 방식이 화면마다 달랐다. 검색·정렬·보기·페이지가 각자 `useState`라
//   새로고침하면 날아가고 링크 공유가 안 됐다(전수 검색 결과 공용 부품 0건).
//   v0.7.446에 ListToolbar/ListSurface/ListPager + useListQuery로 표준을 만들었다.
//
// 이 가드는 **새로 늘어나는 것만** 막는다(ratchet). 아래 PENDING은 표준 이전의 화면이며,
//   "접촉 시 이관" 규칙에 따라 그 화면을 기능 수정으로 건드릴 때 함께 옮기고 목록에서 지운다.
//   목록이 줄기만 하고 늘지 않는 것이 이 가드의 목적이다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { walkFiles, read } from './component-scan.ts'

/** 표준 이전 화면 — 늘리지 말 것. 화면을 건드리면 표준으로 옮기고 여기서 지운다. */
const PENDING = new Set<string>([
  'app/(member)/pricing/gpu/tabs/CompetitorsTab.tsx',
  'app/(member)/pricing/gpu/tabs/DbChatTab.tsx',
  'app/(member)/pricing/gpu/tabs/IntakeGateSummary.tsx',
  'app/(member)/pricing/gpu/tabs/ModelCandidateQueue.tsx',
  'app/(member)/pricing/gpu/tabs/PriceCockpitTab.tsx',
  'app/(member)/pricing/gpu/tabs/PriceTableTab.tsx',
  'app/(member)/pricing/gpu/tabs/SourcesTab.tsx',
  'app/(member)/pricing/gpu/tabs/SpecsTab.tsx',
  'app/(member)/pricing/gpu/tabs/SuppliersTab.tsx',
  'app/(member)/weekly-report/DeptTaskWeeklyPanel.tsx',
  'app/(member)/weekly-report/TeamReportView.tsx',
  'app/(member)/weekly-report/WeeklyReportForm.tsx',
  // kpi/page.tsx = 사람×지표 피벗 교차표, AdminReportsPreview = orgName rowSpan 병합표.
  // 둘 다 "행 목록"이 아니라 ListSurface(컬럼 1벌 → 표/카드)로 표현되지 않는다.
  'app/admin/kpi/page.tsx',
  'app/admin/reports/AdminReportsPreview.tsx',
  'app/develop/DemoSection.tsx',
  'app/develop/page.tsx',
  // GPU 콕핏 내부 패널 — 목록이 아니라 상세/일괄 반영 표면이라 ListSurface(행 목록)로 그대로 옮겨지지 않는다.
  // 그 화면을 손볼 때 함께 정리한다.
  'components/pricing/gpu/unified/BulkReflectPanel.tsx',
  'components/pricing/gpu/unified/DetailPanel.tsx',
  // DynamicTable = 행을 추가·편집하는 **입력 격자**(어드민 콘텐츠 JSON 편집)다.
  // ListSurface는 "읽는 목록"이라 성격이 다르다 — 합치면 둘 다 나빠진다.
  'components/ui/DynamicTable.tsx',
])

/**
 * 목록이 아니라 **문서**인 표면 — 면제이며 «나중에 이관»이 아니다.
 *
 * PENDING 과 섞지 않는다: PENDING 은 «아직 안 옮긴 것»이라 언젠가 0이 되어야 하지만,
 * 이쪽은 성격이 달라 옮기면 오히려 나빠진다. 한 목록에 두면 잔여가 영원히 안 줄고
 * «왜 안 줄지?»를 매번 다시 조사하게 된다.
 *
 * 견적서는 고객에게 인쇄돼 나가는 문서다. ListSurface 는 검색·정렬·선택·페이지가 붙은
 * **읽는 목록**이라 종이에 그대로 옮겨지지 않는다(정렬 화살표가 인쇄된다).
 */
const DOCUMENT_SURFACES = new Set<string>([
  'app/(crm)/crm/quotes/[id]/QuoteDocumentView.tsx',
])

function rawTableFiles(): string[] {
  const hits: string[] = []
  // components/도 함께 본다 — 예전엔 app/만 봐서 공용 폴더에 새 표 부품이 생겨도 통과했다
  // (실제로 NbTable이 그렇게 자라 "표 4방식"이 됐다).
  for (const file of [...walkFiles('app', ['.tsx']), ...walkFiles('components', ['.tsx'])]) {
    const src = read(file)
    if (!src.includes('<table')) continue
    // 표준을 쓰면 화면이 <table>을 직접 적지 않는다
    if (src.includes('components/ui/list/ListSurface')) continue
    hits.push(file)
  }
  return hits
}

test('새 화면은 표를 직접 짜지 않는다 — ListSurface를 쓴다', () => {
  const offenders = rawTableFiles().filter((f) => !PENDING.has(f) && !DOCUMENT_SURFACES.has(f))
  assert.deepEqual(offenders, [],
    `목록 표준을 쓰지 않은 새 화면이 생겼다. ListToolbar/ListSurface/ListPager + useListQuery를 쓸 것:\n  ${offenders.join('\n  ')}`)
})

test('PENDING 항목은 실제로 아직 표준 밖이어야 한다 (죽은 예외 방지)', () => {
  // 이관이 끝난 화면이 목록에 남아 있으면, 그 화면이 다시 표를 자작해도 가드가 못 잡는다.
  const still = new Set(rawTableFiles())
  const stale = [...PENDING].filter((f) => !still.has(f))
  assert.deepEqual(stale, [], `이미 이관된 화면이 예외 목록에 남아 있다. 지울 것: ${stale.join(', ')}`)
})

test('목록 표준 부품은 상태 3종을 스스로 강제한다', () => {
  // 화면이 빈·오류·로딩을 잊어도 부품이 대신 책임진다 — 이게 표준을 쓰는 이유다.
  const surface = read('components/ui/list/ListSurface.tsx')
  for (const part of ['EmptyState', 'ErrorState', 'SkelList']) {
    assert.ok(surface.includes(part), `ListSurface가 ${part}를 쓰지 않는다`)
  }
})

// ── 목록 일괄작업 표준 (v0.7.574) ────────────────────────────────
//
// 실측: 회사 목록에서 여러 건을 골라도 할 수 있는 일이 "AI로 채우기" 하나뿐이었다.
// 20건을 지우려면 상세를 20번 열어야 했다.

test('일괄작업은 서버 bulk 엔드포인트를 새로 만들지 않는다 — 삭제 규칙이 두 벌이 되면 한쪽이 낡는다', () => {
  const bulkRoutes = walkFiles('app/api/crm', ['.ts'])
    .filter((f) => /\/bulk\/route\.ts$/.test(f))
  assert.deepEqual(bulkRoutes, [],
    '한 건짜리 경로를 여러 번 부른다(lib/ui/use-bulk-action.ts). ' +
    'bulk 를 따로 짜면 관계·삭제 계약·감사·워크스페이스 가드 중 하나를 조용히 빠뜨린다')
})

test('되돌릴 수 없는 일괄작업은 확인창을 거친다 — 확인이 유일한 안전장치다(R-5)', () => {
  const hook = read('components/ui/crm/useCrmBulk.tsx')
  assert.match(hook, /<BulkDeleteConfirm\b/, '일괄 삭제 앞에 확인창이 있어야 한다')
  // 확인 없이 곧장 실행하는 길이 없다 — 삭제 버튼은 확인창을 연다
  assert.match(hook, /onClick=\{\(\) => setConfirmOpen\(true\)\}/)
  // 되돌리기는 확인이 필요 없다 — 되돌릴 수 있는 일이다
  assert.match(hook, /bulkRestore\.start\(selection\.selectedIds\)/)
})

test('CRM 목록은 일괄작업을 저마다 짜지 않는다 — 한 벌(useCrmBulk)만 쓴다(§2-5)', () => {
  // 왜: 화면마다 조립하면 넷이 조금씩 달라지고, 사용자에겐 **다른 기능**으로 보인다.
  const views = walkFiles('app/(crm)/crm', ['.tsx'])
    .filter((f) => /(ListView|TableView)\.tsx$/.test(f))
  assert.ok(views.length >= 4, `CRM 목록 화면을 찾지 못했다: ${views.length}`)
  for (const f of views) {
    const src = read(f)
    if (!/\buseRowSelection\b/.test(src)) continue   // 선택이 없는 목록은 대상이 아니다
    // \b 로 잠근다 — `includes` 로 세면 `useCrmBulkXX` 같은 딴 이름도 통과한다(실측)
    assert.match(src, /\buseCrmBulk\b/, `${f}: 선택은 있는데 한 벌(useCrmBulk)을 안 쓴다`)
    assert.ok(!/\buseBulkAction\(/.test(src), `${f}: 일괄 실행을 직접 조립하고 있다`)
  }
})

test('일괄 실패는 이름과 함께 나간다 — id 만 남으면 어느 것이 안 됐는지 모른다', () => {
  const panel = read('components/ui/list/BulkResultPanel.tsx')
  assert.match(panel, /nameList\(g\.labels\)/, '실패 줄이 label 을 렌더해야 한다')
  const hook = read('lib/ui/use-bulk-action.ts')
  // 목록이 다시 그려지기 전에 이름을 떠 둔다 — 지워진 뒤에는 못 찾는다
  assert.match(hook, /const labels = new Map\(ids\.map/)
})

test('한 번에 고를 수 있는 수를 화면과 훅이 같은 상수로 본다 — 갈리면 눌러 놓고 서버에서 잘린다', () => {
  const view = read('app/(crm)/crm/companies/CompanyListView.tsx')
  assert.match(view, /BULK_MAX/, '화면이 상한 상수를 import 해서 써야 한다')
  assert.ok(!/selection\.count > \d+/.test(view), '상한을 화면에 숫자로 적지 않는다')
})

test('queryKey 는 보기 전환을 빼고 만든다 — 표/카드는 같은 데이터를 다르게 그리는 것뿐이다', () => {
  const src = read('lib/ui/use-list-query.ts')
  assert.match(src, /params\.delete\('view'\)/,
    'view 를 빼지 않으면 보기만 바꿔도 목록 조회가 한 번 더 나간다')
})
