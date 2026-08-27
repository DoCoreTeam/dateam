import { Handshake } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import CrmGroupTabs from '@/components/crm/CrmGroupTabs'
import { Suspense } from 'react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import DealsClient from './DealsClient'

export const metadata = { title: '딜 · 영업 CRM' }

export default function CrmDealsPage() {
  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="딜"
        icon={<Handshake size={20} />}
        description="진행 중인 영업 건을 봅니다. 보드는 단계별 현황을, 표는 금액과 닫힌 건까지 보여 줍니다."
        below={<CrmGroupTabs />}
      />
      {/* useSearchParams 는 Suspense 경계가 필요하다 — 없으면 빌드가 전체 페이지를 CSR 로 떨어뜨린다 */}
      <Suspense fallback={<AXDotLoader />}>
        <DealsClient />
      </Suspense>
    </>
  )
}
