import { Package } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import CrmGroupTabs from '@/components/crm/CrmGroupTabs'
import { ENTITY, SERVICE_LABEL } from '@/lib/terms'
import ProductListView from './ProductListView'

export const metadata = { title: '품목 · 영업 CRM' }

export default function CrmProductsPage() {
  return (
    <>
      <PageHeader
        eyebrow={SERVICE_LABEL.crm}
        title={ENTITY.product.label}
        icon={<Package size={20} />}
        description="견적에 올릴 것들을 여기서 관리합니다. 이름을 고치면 다음 견적부터 반영돼요."
        below={<CrmGroupTabs />}
      />
      <ProductListView />
    </>
  )
}
