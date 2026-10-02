'use client'

import { useTransition } from 'react'
import { deleteKpi } from './actions'
import { Trash2 } from 'lucide-react'
import { useAskDialog } from '@/components/ui/useAskDialog'

export default function KpiDeleteButton({ id }: { id: string }) {
  // 브라우저 기본 대화상자 대신 우리 모달 (정책 U-7)
  const { ask, dialog } = useAskDialog()
  const [isPending, startTransition] = useTransition()

  async function handleDelete() {
    if (!await ask.confirm({
      title: 'KPI 항목을 삭제할까요?',
      body: '이 항목에 쌓인 실적 기록도 함께 사라집니다.',
      confirmLabel: '삭제', danger: true,
    })) return
    startTransition(async () => { await deleteKpi(id) })
  }

  return (
    <button
      onClick={handleDelete}
      disabled={isPending}
      aria-label="KPI 삭제"
      style={{
        padding: '0.375rem 0.625rem',
        border: 'var(--hairline) solid var(--danger-border)',
        borderRadius: 'var(--radius)',
        backgroundColor: 'var(--danger-bg)',
        color: 'var(--danger)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        fontSize: 'var(--fs-xs)',
        opacity: isPending ? 0.5 : 1,
        transition: 'opacity 120ms',
      }}
    >
      <Trash2 size={13} />
    {dialog}
    </button>
  )
}
