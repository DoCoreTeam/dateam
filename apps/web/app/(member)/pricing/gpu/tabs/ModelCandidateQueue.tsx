'use client'

import { useState, type ReactNode } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'
import { Sparkles, Check, X } from 'lucide-react'
import { coreModelKey, baseModelName } from '@/lib/gpu/canonical-model'

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

  // 그룹 일괄 등록 — 같은 base 모델의 폼팩터 변형들을 순차 등록(H100의 SXM·PCIe·NVL을 한 번에).
  const actGroup = async (ids: string[]) => {
    setBusy(`grp:${ids[0]}`); setErr(null)
    try {
      for (const id of ids) {
        const res = await fetch('/api/pricing/gpu/model-candidates', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, action: 'register' }),
        })
        if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? '일부 등록 실패'); break }
      }
      await mutate(); onRegistered?.()
    } catch { setErr('처리 실패 — 네트워크를 확인하세요') } finally { setBusy(null) }
  }

  // base 모델(폼팩터 무시)로 후보 묶기 — "H100 SXM/PCIe/NVL"을 흩뿌리지 않고 "H100의 신규 폼팩터"로 제시.
  const groupMap = new Map<string, { name: string; items: Candidate[] }>()
  for (const c of candidates) {
    const key = coreModelKey(c.model_core)
    const g = groupMap.get(key)
    if (g) g.items.push(c)
    else groupMap.set(key, { name: baseModelName(c.model_core), items: [c] })
  }
  const groups = Array.from(groupMap.values())

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
          카탈로그에 없는 신규 모델 {groups.length}종 · {candidates.length}건 — 등록 대기
        </span>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
          같은 모델의 폼팩터(SXM·PCIe·NVL)는 함께 묶었어요. 확인 후 등록하면 다음 반영부터 자동 매칭됩니다.
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
          {groups.flatMap((g) => {
            const rows = [] as ReactNode[]
            // base 그룹 헤더 — 폼팩터가 2개 이상일 때만 "묶음" 헤더(단일 후보는 헤더 생략, 바로 행).
            const ffs = g.items.map((c) => c.form_factor).filter(Boolean) as string[]
            const groupBusy = busy === `grp:${g.items[0].id}`
            if (g.items.length > 1) {
              rows.push(
                <tr key={`grp-${g.name}`} style={{ background: 'var(--surface-bg)' }}>
                  <td className="card-header">
                    <span style={{ fontWeight: 700 }}>{g.name}</span>
                    <span style={{ marginLeft: 'var(--space-2)', fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--warning)' }}>
                      신규 폼팩터 {ffs.join(' · ') || g.items.length}
                    </span>
                  </td>
                  <td data-label="스펙" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>폼팩터별</td>
                  <td data-label="발견 출처">—</td>
                  <td data-label="관측">—</td>
                  <td className="card-actions" data-label="처리">
                    <button className="gpu-btn gpu-btn-primary" disabled={groupBusy}
                      onClick={() => actGroup(g.items.map((c) => c.id))} style={{ gap: 4 }}>
                      <Check size={14} /> 모두 등록 ({g.items.length})
                    </button>
                  </td>
                </tr>,
              )
            }
            for (const c of g.items) {
              const spec = [c.form_factor, c.memory_gb ? `${c.memory_gb}GB` : null].filter(Boolean).join(' · ') || '—'
              const registerName = [c.model_core, c.form_factor].filter(Boolean).join(' ')
              const indented = g.items.length > 1
              rows.push(
                <tr key={c.id} style={indented ? { background: 'var(--color-bg)' } : undefined}>
                  <td className="card-header">
                    <span style={{ fontWeight: indented ? 600 : 700, paddingLeft: indented ? 'var(--space-4)' : 0, fontSize: indented ? 'var(--fs-sm)' : undefined }}>{registerName}</span>
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
                </tr>,
              )
            }
            return rows
          })}
        </tbody>
      </table>
    </div>
  )
}
