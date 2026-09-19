import CompanyDetail from './CompanyDetail'

export const metadata = { title: '회사 상세 · 영업 CRM' }

export default async function CrmCompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <CompanyDetail companyId={(await params).id} />
}
