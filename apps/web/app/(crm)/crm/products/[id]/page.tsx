import { Package } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import CrmGroupTabs from '@/components/crm/CrmGroupTabs'
import { SERVICE_LABEL, PRICEBOOK } from '@/lib/terms'
import ProductDetailView from './ProductDetailView'

export const metadata = { title: '제품 · 가격 기준 · 영업 CRM' }

type Props = { params: Promise<{ id: string }> }

export default async function PriceProductPage({ params }: Props) {
  const { id } = await params
  return (
    <>
      <PageHeader eyebrow={SERVICE_LABEL.crm} title={PRICEBOOK.title} icon={<Package size={20} />} below={<CrmGroupTabs />} />
      <ProductDetailView id={id} />
    </>
  )
}
