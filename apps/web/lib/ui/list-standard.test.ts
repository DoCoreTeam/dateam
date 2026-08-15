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
  const offenders = rawTableFiles().filter((f) => !PENDING.has(f))
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
