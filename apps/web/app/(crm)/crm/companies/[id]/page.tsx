import CompanyDetail from './CompanyDetail'

export const metadata = { title: '회사 상세 · 영업 CRM' }

export default function CrmCompanyDetailPage({ params }: { params: { id: string } }) {
  return <CompanyDetail companyId={params.id} />
}
