// app/(trading)/trading/validation/page.tsx — 검증
//
// 관문과 지연을 한자리에 둔다. 둘 다 「이 전략으로 실제 돈을 걸어도 되나」에 답하는 값이다 —
// 관문은 성적이 되는지를, 지연은 신호가 제때 닿는지를 잰다.

import { ShieldCheck } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import BacktestPanel from '../BacktestPanel'
import LatencyPanel from '../LatencyPanel'
import { loadTradingOverview } from '@/lib/trading/overview'
import { TRADING_NAV_LABEL } from '@/lib/terms'
import { VALIDATION_PAGE_DESCRIPTION } from '@/lib/trading/gate/labels'

export const dynamic = 'force-dynamic'

export default async function TradingValidationPage() {
  const overview = await loadTradingOverview(new Date())
  return (
    <>
      <PageHeader
        title={TRADING_NAV_LABEL.validation}
        icon={<ShieldCheck size={22} />}
        description={VALIDATION_PAGE_DESCRIPTION}
      />
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <BacktestPanel
          criteria={overview.gateCriteria}
          passed={overview.gate.passed}
          failedCount={overview.gate.failedCount}
          insufficientCount={overview.gate.insufficientCount}
          /* 한 번도 안 돌았으면 왜인지 — 「모자라다」와 「안 돌았다」는 할 일이 다르다 */
          empty={overview.gateEmpty}
        />
        <LatencyPanel rows={overview.latency} />
      </div>
    </>
  )
}
