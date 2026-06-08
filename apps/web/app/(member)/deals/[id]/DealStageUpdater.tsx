'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const STAGES = ['신규', '검증', '컨택', 'PoC', '제안', '협상', '수주', '실패'] as const

interface Props {
  dealId: string
  currentStage: string
}

export default function DealStageUpdater({ dealId, currentStage }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function updateStage(stage: string) {
    if (stage === currentStage) return
    setLoading(true)
    await fetch(`/api/deals/${dealId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage }),
    })
    setLoading(false)
    router.refresh()
  }

  return (
    <div className="card" style={{ padding: 'var(--space-5) var(--space-6)' }}>
      <h2 className="tape-title" style={{ margin: 0 }}>단계 변경</h2>
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
              background: stage === currentStage ? 'var(--brand)' : 'white',
              color: stage === currentStage ? 'white' : 'var(--text-muted)',
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
