'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'
import { Sparkles, Check, X } from 'lucide-react'

// 신규 모델 후보 큐(마이그169) — 카탈로그 미등록 관측을 등록 대기로 노출.
//   경쟁사 시세에서 카탈로그에 없는 실존 모델(예 GB300)이 나오면 관측 근거와 함께 여기 쌓인다.
//   admin이 근거(원문 라벨·폼팩터·메모리·출처·관측횟수)를 보고 1클릭 등록/거부한다.
//   자동 생성은 여전히 금지 — 사람이 승인해야 gpu_products로 옮겨진다(깡통 방지 정책 유지).

interface Candidate {
  id: string
  source_model: string
  model_core: string
  form_factor: string | null
  memory_gb: number | null
  competitor: string | null
  source_url: string | null
  observed_count: number
  last_seen_at: string
}

export default function ModelCandidateQueue({ onRegistered }: { onRegistered?: () => void }) {
  const { data, mutate } = useSWR<{ candidates: Candidate[] }>('/api/pricing/gpu/model-candidates', fetcher)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const candidates = data?.candidates ?? []
  if (candidates.length === 0) return null

  const act = async (id: string, action: 'register' | 'reject') => {
    setBusy(id); setErr(null)
    try {
      const res = await fetch('/api/pricing/gpu/model-candidates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(j.error ?? '처리 실패'); return }
      await mutate()
      if (action === 'register') onRegistered?.()
    } catch { setErr('처리 실패 — 네트워크를 확인하세요') } finally { setBusy(null) }
  }

  return (
    <div
      style={{
        margin: '0 0 var(--space-4)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)',
        background: 'var(--warning-bg)', border: 'var(--border-w-2) solid var(--warning-border)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <Sparkles size={15} style={{ color: 'var(--warning)' }} />
        <span style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text)' }}>
          카탈로그에 없는 신규 모델 {candidates.length}건 — 등록 대기
        </span>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
          경쟁사 시세에서 발견됨. 확인 후 등록하면 다음 반영부터 자동 매칭됩니다.
        </span>
      </div>

      {err && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--danger)', marginBottom: 'var(--space-2)' }}>{err}</div>}

      <table className="table-base table-card">
        <thead>
          <tr>
            <th>모델</th>
            <th>스펙</th>
            <th>발견 출처</th>
            <th>관측</th>
            <th>처리</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => {
            const spec = [c.form_factor, c.memory_gb ? `${c.memory_gb}GB` : null].filter(Boolean).join(' · ') || '—'
            const registerName = [c.model_core, c.form_factor].filter(Boolean).join(' ')
            return (
              <tr key={c.id}>
                <td className="card-header">
                  <span style={{ fontWeight: 700 }}>{registerName}</span>
                  {c.source_model !== c.model_core && (
                    <span style={{ marginLeft: 'var(--space-2)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                      원문: {c.source_model}
                    </span>
                  )}
                </td>
                <td data-label="스펙">{spec}</td>
                <td data-label="발견 출처">
                  {c.competitor || '—'}
                  {c.source_url && (
                    <a href={c.source_url} target="_blank" rel="noreferrer"
                      style={{ marginLeft: 'var(--space-1)', fontSize: 'var(--fs-xs)', color: 'var(--brand)' }}>
                      링크
                    </a>
                  )}
                </td>
                <td data-label="관측">{c.observed_count}회</td>
                <td className="card-actions" data-label="처리">
                  <button className="gpu-btn gpu-btn-primary" disabled={busy === c.id}
                    onClick={() => act(c.id, 'register')} style={{ gap: 4 }}>
                    <Check size={14} /> 등록
                  </button>
                  <button className="gpu-btn" disabled={busy === c.id}
                    onClick={() => act(c.id, 'reject')} style={{ gap: 4 }}>
                    <X size={14} /> 무시
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
