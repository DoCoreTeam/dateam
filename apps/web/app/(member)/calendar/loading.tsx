import { SkelPage } from '@/components/ui/LoadingSkeleton'

export default function Loading() {
  return (
    <SkelPage title="캘린더" description="일정과 업무를 한눈에 봅니다">
      <div className="skel" style={{ height: '520px', borderRadius: 'var(--radius-lg)' }} />
    </SkelPage>
  )
}
