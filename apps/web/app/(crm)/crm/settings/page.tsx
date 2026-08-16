import { Settings } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'

// HMR 트리거
export const metadata = { title: '설정 · 영업 CRM' }

export default function CrmSettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="설정"
        icon={<Settings size={20} />}
        description="파이프라인·필드·AI·연동을 관리합니다."
      />
      <EmptyState
        title="설정 화면은 준비 중이에요"
        description="파이프라인과 스테이지는 이미 만들어져 있습니다. 여기서 손보는 화면을 붙이는 중입니다."
        icon={<Settings size={28} />}
        action={{ label: '프로세스 열기', href: '/crm/process' }}
      />
    </>
  )
}
