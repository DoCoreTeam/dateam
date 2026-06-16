import { SkelPage, SkelCard } from '@/components/ui/LoadingSkeleton'

export default function Loading() {
  return (
    <SkelPage title="일일 업무" description="오늘의 업무를 기록하고 정리합니다">
      <SkelCard lines={2} />
      <SkelCard lines={4} />
      <SkelCard lines={3} />
    </SkelPage>
  )
}
