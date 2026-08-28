import { BarChart3 } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import ReportsClient from './ReportsClient'

export const metadata = { title: '리포트 · 영업 CRM' }

export default function CrmReportsPage() {
  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="리포트"
        icon={<BarChart3 size={20} />}
        description="얼마를 따냈고, 이 기간에 얼마가 매출로 잡히며, 아직 안 판 몫이 얼마인지 봅니다. 아래에서 지금 걸려 있는 딜도 단계로 봅니다."
      />
      <ReportsClient />
    </>
  )
}
