import { Settings } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import CrmGroupTabs from '@/components/crm/CrmGroupTabs'
import BudgetCard from './BudgetCard'
import SettingsCard from './SettingsCard'
import QuoteTermsCard from './QuoteTermsCard'
import PipelineCard from './PipelineCard'
import BusinessTypeCard from './BusinessTypeCard'
import DuplicatesCard from './DuplicatesCard'
import DataCheckCard from './DataCheckCard'
import IntegrationCard from './IntegrationCard'
import AutoApplyCard from './AutoApplyCard'
import ExportCard from './ExportCard'
import ImportCard from './ImportCard'
import AutomationCard from './AutomationCard'
import { resolveCrmAccess, hasCrmRole } from '@/lib/crm/auth/requireCrmMember'
import styles from './settings.module.css'

export const metadata = { title: '설정 · 영업 CRM' }

export default async function CrmSettingsPage() {
  /*
    목록 읽기는 전원에게 열려 있고(READONLY) 바꾸기만 ADMIN 이다.
    화면에서만 숨기면 API 로 새어 나가므로 서버도 같은 판정을 갖는다 —
    여기서 정하는 것은 «못 누를 버튼을 그리지 않는 것»뿐이다(영업 단계 화면과 같은 방식).
  */
  const access = await resolveCrmAccess()
  const canEdit = access.ok ? hasCrmRole(access.session.role, 'ADMIN') : false

  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="설정"
        icon={<Settings size={20} />}
        description="파이프라인·사업 유형·필드·AI·연동을 관리합니다."
        below={<CrmGroupTabs />}
      />
      {/* 카드마다 저장한다(§2-5-4) — 탭 하단 일괄 저장 바를 두지 않는다 */}
      <div className={styles.grid}>
        {/*
          딜을 만들 때 고르는 순서대로 둔다 — 파이프라인 → 사업 유형.
          예전에는 사업 유형만 여기 있고 파이프라인은 「영업 단계」 화면에 얹혀 있었다.
          정작 딜 화면은 「설정에서 파이프라인을 만들면」이라 안내하고 있었다
          (DealBoard.tsx:250 · DealsClient.tsx:138 — 사용자 지적 2026-09-09).
        */}
        <PipelineCard canEdit={canEdit} />
        <BusinessTypeCard canEdit={canEdit} />
        <BudgetCard />
        <SettingsCard />
        {/* 거래 조건은 견적서에 인쇄되는 것이라 공급자 설정 바로 다음이다 */}
        <QuoteTermsCard />
        <AutoApplyCard />
        <IntegrationCard />
        <DataCheckCard />
        <DuplicatesCard />
        <AutomationCard />
        <ImportCard />
        <ExportCard />
      </div>
    </>
  )
}
