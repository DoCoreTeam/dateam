import { BarChart3 } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import ReportsClient from './ReportsClient'
import MetricsClient from './MetricsClient'

export const metadata = { title: '리포트 · 영업 CRM' }

export default function CrmReportsPage() {
  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="리포트"
        icon={<BarChart3 size={20} />}
        description="얼마를 따냈고, 이 기간에 얼마가 매출로 잡히며, 아직 안 판 몫이 얼마인지 봅니다. 지표 탭에서는 기간·기준을 골라 조합해 봅니다."
      />
      <SegmentedTabs
        ariaLabel="리포트 보기"
        tabs={[
          {
            id: 'metrics',
            label: '지표',
            sub: '기간 · 기준을 골라 조합',
            content: <MetricsClient />,
          },
          {
            id: 'summary',
            label: '현황',
            sub: '파이프라인 단계별',
            content: <ReportsClient />,
          },
        ]}
      />
    </>
  )
}
