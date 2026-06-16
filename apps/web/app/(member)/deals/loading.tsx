import { SkelPage, SkelList } from '@/components/ui/LoadingSkeleton'

export default function Loading() {
  return (
    <SkelPage title="딜" description="영업 기회를 단계별로 관리합니다">
      <SkelList rows={8} />
    </SkelPage>
  )
}
