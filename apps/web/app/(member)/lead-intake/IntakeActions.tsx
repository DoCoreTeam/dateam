'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useAskDialog } from '@/components/ui/useAskDialog'
import { ACTION } from '@/lib/terms'

interface Props {
  intakeId: string
  notes: string | null
}

// 리드 인테이크 행 액션 — 메모 편집(PATCH) + 삭제(DELETE). 서버 컴포넌트 목록에 끼워 사용.
export default function IntakeActions({ intakeId, notes }: Props) {
  // 브라우저 기본 대화상자 대신 우리 모달(§2-5·§2-2)
  const { ask, dialog } = useAskDialog()
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleEdit() {
    const next = await ask.text({
      title: '메모 수정', label: '메모', defaultValue: notes ?? '', confirmLabel: ACTION.save,
    })
    if (next === null) return
    setLoading(true)
    const res = await fetch(`/api/lead-intakes/${intakeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: next }),
    })
    if (res.ok) router.refresh()
    else await ask.notice({ title: '수정하지 못했습니다', body: '잠시 후 다시 시도해 주세요. 쓰신 메모는 아직 저장되지 않았습니다.' })
    setLoading(false)
  }

  async function handleDelete() {
    if (!await ask.confirm({
      title: '받은 기록을 삭제할까요?',
      body: '이 기록이 목록에서 사라집니다.',
      confirmLabel: ACTION.delete, danger: true,
    })) return
    setLoading(true)
    const res = await fetch(`/api/lead-intakes/${intakeId}`, { method: 'DELETE' })
    if (res.ok) router.refresh()
    else {
      await ask.notice({ title: '삭제하지 못했습니다', body: '잠시 후 다시 시도해 주세요. 아직 지워지지 않았습니다.' })
      setLoading(false)
    }
  }

  const btn = { fontSize: 'var(--fs-xs)', fontWeight: 600, background: 'none', borderRadius: 'var(--radius)', cursor: 'pointer', padding: 'var(--space-1) var(--space-2)', minHeight: '32px' } as const

  return (
    <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
      <button onClick={handleEdit} disabled={loading} style={{ ...btn, color: 'var(--brand)', border: 'var(--hairline) solid var(--brand-soft-2)' }}>메모</button>
      <button onClick={handleDelete} disabled={loading} style={{ ...btn, color: 'var(--danger)', border: 'var(--hairline) solid var(--danger-border)' }}>삭제</button>
      {/* 대화상자는 렌더해야 뜬다 — 안 그리면 물어도 안 나오고 그대로 멈춘다 */}
      {dialog}
    </div>
  )
}
