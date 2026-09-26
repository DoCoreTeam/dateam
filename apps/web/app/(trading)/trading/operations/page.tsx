// app/(trading)/trading/operations/page.tsx — 운영
//
// 도는 것을 지켜보는 자리. 점검(무엇이 이상한가) · 무장(자동 주문을 열어 뒀나) ·
// 최근 실행(제때 돌았나) 셋은 같은 질문의 세 면이라 한자리에 둔다.

import { Activity } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import OperatorPanel from '../OperatorPanel'
import ArmingPanel from '../ArmingPanel'
import RecentRuns from '../RecentRuns'
import { loadTradingOverview } from '@/lib/trading/overview'
import { TRADING_NAV_LABEL } from '@/lib/terms'

export const dynamic = 'force-dynamic'

export default async function TradingOperationsPage() {
  const overview = await loadTradingOverview(new Date())
  return (
    <>
      <PageHeader
        title={TRADING_NAV_LABEL.operations}
        icon={<Activity size={22} />}
        description="제때 돌고 있는지, 이상한 곳은 없는지 봅니다"
      />
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <OperatorPanel operator={overview.operator} />
        <ArmingPanel arming={overview.arming} />
        <RecentRuns rows={overview.recentRuns} />
      </div>
    </>
  )
}
