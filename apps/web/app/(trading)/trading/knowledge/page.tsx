// app/(trading)/trading/knowledge/page.tsx — 지식

import { BookOpen } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import KnowledgePanel from '../KnowledgePanel'
import { loadTradingOverview } from '@/lib/trading/overview'
import { TRADING_NAV_LABEL } from '@/lib/terms'

export const dynamic = 'force-dynamic'

export default async function TradingKnowledgePage() {
  const overview = await loadTradingOverview(new Date())
  return (
    <>
      <PageHeader
        title={TRADING_NAV_LABEL.knowledge}
        icon={<BookOpen size={22} />}
        description="지금 시점에 알 수 있는 것만 보입니다. 설정 변경은 사람이 받아들여야 적용됩니다"
      />
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <KnowledgePanel rows={overview.knowledge} progress={overview.knowledgeProgress} />
      </div>
    </>
  )
}
