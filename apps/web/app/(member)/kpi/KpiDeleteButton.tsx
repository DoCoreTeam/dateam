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
        border: '1px solid #fecaca',
        borderRadius: '0.5rem',
        backgroundColor: '#fef2f2',
        color: '#dc2626',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.25rem',
        fontSize: '0.75rem',
        opacity: isPending ? 0.5 : 1,
        transition: 'opacity 120ms',
      }}
    >
      <Trash2 size={13} />
    </button>
  )
}
