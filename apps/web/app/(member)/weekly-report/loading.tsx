import { SkelPage, SkelCard } from '@/components/ui/LoadingSkeleton'

export default function Loading() {
  return (
    <SkelPage title="주간보고" description="주간 성과, 계획, 이슈를 기록합니다">
      <SkelCard lines={5} />
      <SkelCard lines={3} />
    </SkelPage>
  )
}
