import { SkelPage, SkelList } from '@/components/ui/LoadingSkeleton'

export default function Loading() {
  return (
    <SkelPage title="연락처" description="고객 담당자 정보를 관리합니다">
      <SkelList rows={8} />
    </SkelPage>
  )
}
