// app/(trading)/trading/judgments/page.tsx — 판단 기록
//
// **왜 자기 자리인가**: 이건 **쌓이는 목록**이다. 현황에 얹어 두면 날이 갈수록
// 현황이 길어지고, 매일 보는 세 줄이 기록에 밀려 내려간다.

import { ClipboardList } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import JudgmentList from '../JudgmentList'
import { loadTradingOverview } from '@/lib/trading/overview'
import { TRADING_NAV_LABEL } from '@/lib/terms'

export const dynamic = 'force-dynamic'

export default async function TradingJudgmentsPage() {
  const overview = await loadTradingOverview(new Date())
  return (
    <>
      <PageHeader
        title={TRADING_NAV_LABEL.judgments}
        icon={<ClipboardList size={22} />}
        description="무엇을 근거로 어떻게 판단했는지의 기록입니다. 신호가 안 나간 판단도 남습니다"
      />
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <JudgmentList rows={overview.judgments} />
      </div>
    </>
  )
}
