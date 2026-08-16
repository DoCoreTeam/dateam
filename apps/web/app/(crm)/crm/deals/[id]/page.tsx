import DealDetail from './DealDetail'

export const metadata = { title: '딜 상세 · 영업 CRM' }

export default function CrmDealDetailPage({ params }: { params: { id: string } }) {
  return <DealDetail dealId={params.id} />
}
