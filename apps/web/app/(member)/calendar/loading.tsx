import { SkelPage } from '@/components/ui/LoadingSkeleton'

export default function Loading() {
  return (
    <SkelPage title="캘린더">
      <div className="skel" style={{ height: '520px', borderRadius: 'var(--radius-lg)' }} />
    </SkelPage>
  )
}
