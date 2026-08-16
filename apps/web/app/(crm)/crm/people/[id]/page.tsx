import PersonDetail from './PersonDetail'

export const metadata = { title: '인물 상세 · 영업 CRM' }

export default function CrmPersonDetailPage({ params }: { params: { id: string } }) {
  return <PersonDetail personId={params.id} />
}
