'use client'

import { useTransition } from 'react'
import { deleteKpi } from './actions'
import { Trash2 } from 'lucide-react'

export default function KpiDeleteButton({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition()

  function handleDelete() {
    if (!confirm('이 KPI 항목을 삭제하시겠습니까?')) return
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
    </button>
  )
}
