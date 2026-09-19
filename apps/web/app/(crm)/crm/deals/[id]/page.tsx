import DealDetail from './DealDetail'

export const metadata = { title: '딜 상세 · 영업 CRM' }

export default async function CrmDealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <DealDetail dealId={(await params).id} />
}
