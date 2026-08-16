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
        description="파이프라인 합계와 성사율을 봅니다."
      />
      <ReportsClient />
    </>
  )
}
