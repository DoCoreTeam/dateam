import { CheckSquare } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
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
      />
      <TasksClient />
    </>
  )
}
