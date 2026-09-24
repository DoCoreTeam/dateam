import type { ReactNode } from 'react'
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
import SettingsCards, { type SettingsCardEntry } from '@/components/ui/settings/SettingsCards'
import { CanEditProvider } from '@/lib/crm/ui/can-edit'
import { canExport } from '@/lib/access/guard'
import {
  CRM_SETTINGS_CARDS, CRM_SETTINGS_TAB, CRM_SETTINGS_TAB_ORDER,
} from '@/lib/crm/domain/settings-tab'

export const metadata = { title: '설정 · 영업 CRM' }

export default async function CrmSettingsPage() {
  /*
    목록 읽기는 전원에게 열려 있고(READONLY) 바꾸기만 ADMIN 이다.
    화면에서만 숨기면 API 로 새어 나가므로 서버도 같은 판정을 갖는다 —
    여기서 정하는 것은 «못 누를 버튼을 그리지 않는 것»뿐이다(영업 단계 화면과 같은 방식).
  */
  const access = await resolveCrmAccess()
  /*
    카드마다 서버가 요구하는 것이 다르다(실측 2026-09-23):
    파이프라인·사업 유형·거래 조건·예산·자동화·필드·중복 정리는 ADMIN,
    가져오기·데이터 점검·연동은 MEMBER, 내보내기는 역할이 아니라 부여가 정한다.
    하나로 묶어 ADMIN 으로 감추면 멤버가 **할 수 있는 일까지** 사라진다.
  */
  const ability = {
    canEdit: access.ok ? hasCrmRole(access.session.role, 'ADMIN') : false,
    canWrite: access.ok ? hasCrmRole(access.session.role, 'MEMBER') : false,
    canExport: access.ok ? await canExport('/crm') : false,
  }

  /*
    카드가 서는 자리는 `lib/crm/domain/settings-tab.ts` 가 정한다.
    여기서는 이름과 알맹이만 짝지어 준다 — 목록에 없는 이름을 쓰면 시험이 먼저 잡는다.

    예전에는 딜을 만들 때 고르는 순서대로(파이프라인 → 사업 유형) 한 격자에 열두 장을
    늘어놓았다. 사업 유형만 여기 있고 파이프라인은 「영업 단계」 화면에 얹혀 있던 시절의
    흔적이다(DealBoard.tsx:250 · DealsClient.tsx:138 — 사용자 지적 2026-09-09).
    이제 그 순서는 「영업 단계」 탭 안에 그대로 있다.
  */
  const node: Record<string, ReactNode> = {
    PipelineCard: <PipelineCard />,
    BusinessTypeCard: <BusinessTypeCard />,
    'SettingsCard.quote': <SettingsCard group="quote" />,
    QuoteTermsCard: <QuoteTermsCard />,
    'SettingsCard.quoteImport': <SettingsCard group="quoteImport" />,
    BudgetCard: <BudgetCard />,
    'SettingsCard.ai': <SettingsCard group="ai" />,
    AutoApplyCard: <AutoApplyCard />,
    AutomationCard: <AutomationCard />,
    IntegrationCard: <IntegrationCard />,
    DataCheckCard: <DataCheckCard />,
    DuplicatesCard: <DuplicatesCard />,
    ImportCard: <ImportCard />,
    ExportCard: <ExportCard />,
  }
  const cards: SettingsCardEntry[] = CRM_SETTINGS_CARDS.map((c) => ({
    id: c.id, tab: c.tab, title: c.title, keywords: c.keywords, content: node[c.id],
  }))

  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="설정"
        icon={<Settings size={20} />}
        description="파이프라인·사업 유형·필드·AI·연동을 관리합니다."
        below={<CrmGroupTabs />}
      />
      {/*
        카드마다 저장한다(§2-5-4) — 탭 하단 일괄 저장 바를 두지 않는다.
        권한은 여기서 한 번만 내려 준다 — 카드 열넷에 프롭을 꽂으면 하나 빠뜨려도
        아무도 모르고, 실제로 그렇게 열둘이 빠져 있었다.
      */}
      <CanEditProvider value={ability}>
        <SettingsCards
          groups={CRM_SETTINGS_TAB_ORDER.map((t) => ({ id: t, label: CRM_SETTINGS_TAB[t].label }))}
          cards={cards}
        />
      </CanEditProvider>
    </>
  )
}
