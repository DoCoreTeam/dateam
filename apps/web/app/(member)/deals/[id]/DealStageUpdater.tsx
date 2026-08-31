'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { withSubmitGuard } from '@/lib/forms/submit-guard'

const STAGES = ['신규', '검증', '컨택', 'PoC', '제안', '협상', '수주', '실패'] as const

interface Props {
  dealId: string
  currentStage: string
}

export default function DealStageUpdater({ dealId, currentStage }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function updateStage(stage: string) {
    if (stage === currentStage) return
    setLoading(true)
    setError('')
    // 예전엔 응답을 아예 안 봤다 — 서버가 500 을 줘도 새로고침만 해서
    // 「눌렀는데 단계가 그대로」로만 보이고 이유가 어디에도 안 남았다.
    await withSubmitGuard(async (signal) => {
      const res = await fetch(`/api/deals/${dealId}`, {
        signal,
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        setError(d.error ?? '단계를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.')
        return
      }
      router.refresh()
    }, { onError: setError, onDone: () => setLoading(false) })
  }

  return (
    <div className="card" style={{ padding: 'var(--space-5) var(--space-6)' }}>
      <h2 className="tape-title" style={{ margin: 0 }}>단계 변경</h2>
      {error && (
        <p role="alert" style={{ margin: 'var(--space-2) 0 0', color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>
          {error}
        </p>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
        {STAGES.map((stage) => (
          <button
            key={stage}
            onClick={() => updateStage(stage)}
            disabled={loading}
            style={{
              padding: '0.375rem 0.75rem',
              borderRadius: '9999px',
              fontSize: 'var(--fs-sm)',
              fontWeight: 600,
              border: 'var(--hairline) solid',
              cursor: stage === currentStage ? 'default' : 'pointer',
              background: stage === currentStage ? 'var(--brand)' : 'var(--color-surface)',
              color: stage === currentStage ? 'var(--brand-fg)' : 'var(--text-muted)',
              borderColor: stage === currentStage ? 'var(--brand)' : 'var(--color-border)',
              minHeight: '36px',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {stage}
          </button>
        ))}
      </div>
    </div>
  )
}
