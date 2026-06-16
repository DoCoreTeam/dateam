import { SkelPage, SkelCard, SkelList } from '@/components/ui/LoadingSkeleton'

export default function Loading() {
  return (
    <SkelPage title="업무 현황" description="고객·딜·프로젝트 축으로 업무를 조망합니다">
      <SkelCard lines={2} />
      <SkelList rows={5} />
    </SkelPage>
  )
}
