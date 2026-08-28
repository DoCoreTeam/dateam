import { Settings } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import CrmGroupTabs from '@/components/crm/CrmGroupTabs'
import BudgetCard from './BudgetCard'
import SettingsCard from './SettingsCard'
import QuoteTermsCard from './QuoteTermsCard'
import DuplicatesCard from './DuplicatesCard'
import DataCheckCard from './DataCheckCard'
import IntegrationCard from './IntegrationCard'
import AutoApplyCard from './AutoApplyCard'
import ExportCard from './ExportCard'
import ImportCard from './ImportCard'
import AutomationCard from './AutomationCard'
import styles from './settings.module.css'

export const metadata = { title: '설정 · 영업 CRM' }

export default function CrmSettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="설정"
        icon={<Settings size={20} />}
        description="파이프라인·필드·AI·연동을 관리합니다."
        below={<CrmGroupTabs />}
      />
      {/* 카드마다 저장한다(§2-5-4) — 탭 하단 일괄 저장 바를 두지 않는다 */}
      <div className={styles.grid}>
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
