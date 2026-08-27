import { Suspense } from 'react'
import { CheckSquare } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import CrmGroupTabs from '@/components/crm/CrmGroupTabs'
import TasksClient from './TasksClient'

export const metadata = { title: '할 일 · 영업 CRM' }

export default function CrmTasksPage() {
  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="할 일"
        icon={<CheckSquare size={20} />}
        description="미팅에서 나온 '다음에 할 일'을 인박스에서 반영하면 여기 쌓입니다."
        below={<CrmGroupTabs />}
      />
      {/**
        * `useSearchParams()`(캘린더에서 넘어오는 `?due=`)는 정적 프리렌더에서 CSR bailout 을
        * 일으킨다 — 경계가 없으면 `next build` 가 이 페이지에서 통째로 실패한다.
        * dev 서버는 멀쩡해서 이틀간 안 드러났던 전례가 있다(SegmentedTabs 주석).
        */}
      <Suspense fallback={null}>
        <TasksClient />
      </Suspense>
    </>
  )
}
