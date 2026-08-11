'use client'

// components/ci/CiOnboardingGate.tsx — 콜드 스타트 (설계서 §8.6)
// "데이터 없는 빈 대시보드를 보여주는 상황을 설계상 금지한다."
// 워크스페이스가 없으면 대시보드 대신 이 흐름이 뜬다.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ApiResponse } from '@/lib/ci/contracts'

const TOPIC_SUGGESTIONS = ['요리', 'IT·테크', '뷰티', '게임', '재테크', '여행', '운동', '교육']

export default function CiOnboardingGate() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    if (!name.trim()) { setError('워크스페이스 이름을 입력해 주세요'); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/ci/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), defaultTopicName: topic.trim() || undefined }),
      }).then((r) => r.json() as Promise<ApiResponse<{ id: string }>>)

      if (!res.success) { setError(res.error.message); return }
      router.refresh()
    } catch {
      setError('워크스페이스를 만들지 못했습니다. 잠시 후 다시 시도해 주세요')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section style={{ maxWidth: '560px', margin: '0 auto', paddingTop: 'var(--space-12)' }}>
      <h1 style={{
        fontSize: 'var(--fs-2xl)', fontWeight: 700,
        letterSpacing: '-0.03em', color: 'var(--text)', marginBottom: 'var(--space-2)',
      }}>
        시작할 공간을 만듭니다
      </h1>
      <p className="ci-empty-desc" style={{ marginBottom: 'var(--space-6)' }}>
        주제를 하나 고르면 관심 채널을 추천하고 첫 자동 업데이트를 예약합니다.
        설정을 하나도 건드리지 않아도 바로 쓸 수 있습니다.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div>
          <label className="label" htmlFor="ci-ws-name">워크스페이스 이름</label>
          <input className="input-field"
            id="ci-ws-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 우리 채널"
            maxLength={60}
          />
        </div>

        <div>
          <label className="label" htmlFor="ci-ws-topic">주로 다루는 주제 (선택)</label>
          <input className="input-field"
            id="ci-ws-topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="예: 요리"
            maxLength={40}
          />
          <div className="ci-card-badges" style={{ marginTop: 'var(--space-2)' }}>
            {TOPIC_SUGGESTIONS.map((t) => (
              <button key={t} type="button" className="ci-metric" onClick={() => setTopic(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="ci-error" role="alert">{error}</p>}

        <button type="button" className="btn-primary" onClick={create} disabled={busy}>
          {busy ? '만드는 중…' : '워크스페이스 만들기'}
        </button>
      </div>
    </section>
  )
}
