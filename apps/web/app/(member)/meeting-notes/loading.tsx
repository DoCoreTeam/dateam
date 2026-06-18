import { SkelPage, SkelList } from '@/components/ui/LoadingSkeleton'

export default function Loading() {
  return (
    <SkelPage title="회의노트" description="회의 기록을 정리하고 AI로 요약·업무 추출까지 한 번에">
      <div className="card">
        <SkelList rows={6} />
      </div>
    </SkelPage>
  )
}
