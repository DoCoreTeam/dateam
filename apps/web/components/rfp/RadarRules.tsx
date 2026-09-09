'use client'

// 레이더 규칙과 적중 목록 — **자동은 찾기까지다.**
//
// 케이스로 만드는 것은 사람이 고른다. 자동으로 만들면 분석 비용이 자동으로 나가고
// 아무도 안 볼 리포트가 쌓인다.

import { useCallback, useState } from 'react'
import { Radar as RadarIcon } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import EmptyState from '@/components/ui/EmptyState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { RFP_RADAR, RFP_COMMON } from '@/lib/rfp/terms'

export interface RadarHitRow {
  id: string
  rule_id: string
  source_id: string
  case_id: string | null
  pre_score: number | null
  reason: string | null
  status: string
}

export interface RadarRuleRow {
  id: string
  name: string
  keywords: string[]
  budget_min: number | null
  budget_max: number | null
  enabled: boolean
}

export interface RadarRulesProps {
  initialRules: RadarRuleRow[]
  initialHits: RadarHitRow[]
}

export default function RadarRules({ initialRules, initialHits }: RadarRulesProps) {
  const [rules] = useState(initialRules)
  const [hits, setHits] = useState(initialHits)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sweep = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/rfp/radar', { method: 'POST' })
      if (!res.ok) { setError(RFP_COMMON.error); return }
      const list = await fetch('/api/rfp/radar', { cache: 'no-store' })
      const body = await list.json()
      setHits(body.hits ?? [])
    } catch {
      setError(RFP_COMMON.error)
    } finally {
      setBusy(false)
    }
  }, [])

  return (
    <div>
      {error && <FormErrorBanner message={error} />}

      <section className="card">
        <span className="label">{RFP_RADAR.rules}</span>
        {rules.length === 0 ? (
          <p style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>{RFP_RADAR.emptyDesc}</p>
        ) : (
          <ul>
            {rules.map((r) => (
              <li key={r.id}>
                <span>{r.name}</span>
                <NbBadge status={r.enabled ? 'done' : 'note'}>{r.keywords.join(', ')}</NbBadge>
              </li>
            ))}
          </ul>
        )}
        <NbButton onClick={() => void sweep()} disabled={busy}>
          <RadarIcon size={14} /> {RFP_RADAR.sweepNow}
        </NbButton>
      </section>

      <section>
        <h2 className="label">{RFP_RADAR.hits}</h2>
        {hits.length === 0 ? (
          <EmptyState title={RFP_RADAR.emptyTitle} description={RFP_RADAR.emptyDesc} />
        ) : (
          <ul>
            {/* 사전 점수 높은 것부터 — 사용자는 위에서 몇 개만 본다 */}
            {hits.map((h) => (
              <li key={h.id} className="card">
                <NbBadge status="doing">{h.pre_score ?? 0}</NbBadge>
                <span style={{ marginLeft: 'var(--space-2)' }}>{h.reason}</span>
                {/* 케이스로 만드는 것은 사람이 고른다 */}
                <NbButton variant="ghost" href={`/rfp/new?source=${h.source_id}`}>
                  {RFP_RADAR.openCase}
                </NbButton>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
