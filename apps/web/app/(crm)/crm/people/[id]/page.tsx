import PersonDetail from './PersonDetail'

export const metadata = { title: '인물 상세 · 영업 CRM' }

export default async function CrmPersonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <PersonDetail personId={(await params).id} />
}
