import { Package } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import CrmGroupTabs from '@/components/crm/CrmGroupTabs'
import { SERVICE_LABEL, PRICEBOOK } from '@/lib/terms'
import PricebookTabs from './PricebookTabs'

export const metadata = { title: '가격 기준 · 영업 CRM' }

/**
 * 가격 기준 — 예전 「품목」 화면이 넓어졌다(P0135)
 *
 * 제품 하나에는 품목 여러 줄과 규칙과 할인이 함께 들어 있다. 그래서 목록에서 더하고 지우고
 * 상세로 들어가 설정하는 화면이 따로 있어야 한다. 화면은 한 벌이고 문은 둘이다(딜 메뉴, 설정의 견적 탭).
 */
export default function CrmProductsPage() {
  return (
    <>
      <PageHeader
        eyebrow={SERVICE_LABEL.crm}
        title={PRICEBOOK.title}
        icon={<Package size={20} />}
        below={<CrmGroupTabs />}
      />
      <PricebookTabs />
    </>
  )
}
