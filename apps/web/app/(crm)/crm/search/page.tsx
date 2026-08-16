import { Search } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import SearchClient from './SearchClient'

export const metadata = { title: '찾기 · 영업 CRM' }

// 검색어가 주소에 있다 — 링크로 공유되고 새로고침해도 같은 결과가 나온다
export default async function CrmSearchPage({
  searchParams,
}: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams

  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="찾기"
        icon={<Search size={20} />}
        description="회사·인물·딜·미팅을 한 번에 찾습니다."
      />
      <SearchClient initialQuery={q ?? ''} />
    </>
  )
}
