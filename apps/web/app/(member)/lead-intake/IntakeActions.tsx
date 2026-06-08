'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface Props {
  intakeId: string
  notes: string | null
}

// 리드 인테이크 행 액션 — 메모 편집(PATCH) + 삭제(DELETE). 서버 컴포넌트 목록에 끼워 사용.
export default function IntakeActions({ intakeId, notes }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleEdit() {
    const next = window.prompt('메모 수정', notes ?? '')
    if (next === null) return
    setLoading(true)
    const res = await fetch(`/api/lead-intakes/${intakeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: next }),
    })
    if (res.ok) router.refresh()
    else alert('수정에 실패했습니다')
    setLoading(false)
  }

  async function handleDelete() {
    if (!confirm('이 인테이크 기록을 삭제하시겠습니까?')) return
    setLoading(true)
    const res = await fetch(`/api/lead-intakes/${intakeId}`, { method: 'DELETE' })
    if (res.ok) router.refresh()
    else { alert('삭제에 실패했습니다'); setLoading(false) }
  }

  const btn = { fontSize: 'var(--fs-xs)', fontWeight: 600, background: 'none', borderRadius: 'var(--radius)', cursor: 'pointer', padding: 'var(--space-1) var(--space-2)', minHeight: '32px' } as const

  return (
    <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
      <button onClick={handleEdit} disabled={loading} style={{ ...btn, color: 'var(--brand)', border: 'var(--hairline) solid var(--brand-soft-2)' }}>메모</button>
      <button onClick={handleDelete} disabled={loading} style={{ ...btn, color: 'var(--danger)', border: 'var(--hairline) solid var(--danger-border)' }}>삭제</button>
    </div>
  )
}
