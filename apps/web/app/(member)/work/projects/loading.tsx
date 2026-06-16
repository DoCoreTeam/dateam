import { SkelPage, SkelList } from '@/components/ui/LoadingSkeleton'

export default function Loading() {
  return (
    <SkelPage title="프로젝트 관리" description="프로젝트를 등록하고 업무를 묶어 관리합니다">
      <SkelList rows={7} />
    </SkelPage>
  )
}
