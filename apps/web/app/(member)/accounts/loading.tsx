import { SkelPage, SkelList } from '@/components/ui/LoadingSkeleton'

export default function Loading() {
  return (
    <SkelPage title="거래처" description="고객사를 등록하고 관리합니다">
      <SkelList rows={8} />
    </SkelPage>
  )
}
