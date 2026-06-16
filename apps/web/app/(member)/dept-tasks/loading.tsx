import { SkelPage, SkelCard, SkelList } from '@/components/ui/LoadingSkeleton'

export default function Loading() {
  return (
    <SkelPage title="부서 업무" description="부서 단위 업무를 등록하고 담당자를 지정합니다">
      <SkelCard lines={2} />
      <SkelList rows={6} />
    </SkelPage>
  )
}
