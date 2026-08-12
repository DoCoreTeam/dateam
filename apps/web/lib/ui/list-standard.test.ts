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
  'app/(ci)/ci/assets/AssetsView.tsx',
  'app/(ci)/ci/boards/BoardsView.tsx',
  'app/(ci)/ci/briefs/[id]/BriefEditor.tsx',
  'app/(ci)/ci/inbox/InboxView.tsx',
  'app/(ci)/ci/performance/PerformanceView.tsx',
  'app/(ci)/ci/publish/PublishView.tsx',
  'app/(ci)/ci/trends/TrendsView.tsx',
  'app/(member)/accounts/page.tsx',
  'app/(member)/deals/page.tsx',
  'app/(member)/dept-tasks/DeptTasksClient.tsx',
  'app/(member)/kpi/page.tsx',
  'app/(member)/lead-intake/page.tsx',
  'app/(member)/meeting-notes/page.tsx',
  'app/(member)/operations/page.tsx',
  'app/(member)/pricing/gpu/tabs/CompetitorsTab.tsx',
  'app/(member)/pricing/gpu/tabs/DbChatTab.tsx',
  'app/(member)/pricing/gpu/tabs/IntakeGateSummary.tsx',
  'app/(member)/pricing/gpu/tabs/ModelCandidateQueue.tsx',
  'app/(member)/pricing/gpu/tabs/PriceCockpitTab.tsx',
  'app/(member)/pricing/gpu/tabs/PriceTableTab.tsx',
  'app/(member)/pricing/gpu/tabs/SourcesTab.tsx',
  'app/(member)/pricing/gpu/tabs/SpecsTab.tsx',
  'app/(member)/pricing/gpu/tabs/SuppliersTab.tsx',
  'app/(member)/routine/RoutineGrid.tsx',
  'app/(member)/weekly-report/DeptTaskWeeklyPanel.tsx',
  'app/(member)/weekly-report/TeamReportView.tsx',
  'app/(member)/weekly-report/WeeklyReportForm.tsx',
  'app/admin/ai-prompts/AiPromptsClient.tsx',
  'app/admin/ai-usage/AiUsageDashboard.tsx',
  'app/admin/api/page.tsx',
  'app/admin/daily-logs/DayDetailPanel.tsx',
  'app/admin/kpi/page.tsx',
  'app/admin/partner-tiers/page.tsx',
  'app/admin/reports/AdminReportsPreview.tsx',
  'app/admin/reports/page.tsx',
  'app/admin/routine/page.tsx',
  'app/admin/users/UserTable.tsx',
  'app/develop/DemoSection.tsx',
  'app/develop/page.tsx',
])

function rawTableFiles(): string[] {
  const hits: string[] = []
  for (const file of walkFiles('app', ['.tsx'])) {
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
