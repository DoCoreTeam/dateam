'use client'

// 결과 기록 — 이 데이터가 학습의 정답지다.
//
// **참여 여부와 순위를 구분해 적는다.** 안 낸 것과 내고 떨어진 것은 다른 사실이고,
// 학습에서 다르게 쓰인다.

import { useState } from 'react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { RFP_RADAR, RFP_COMMON } from '@/lib/rfp/terms'

export interface OutcomeFormProps {
  caseId: string
  initial: {
    decision: string
    submitted: boolean | null
    result: string | null
    awardedTo: string | null
    awardedAmount: number | null
    ourRank: number | null
    source: string
  } | null
}

const DECISIONS = ['go', 'partial', 'no_go', 'undecided'] as const
const RESULTS = ['won', 'lost', 'cancelled', 'unknown'] as const

export default function OutcomeForm({ caseId, initial }: OutcomeFormProps) {
  const [decision, setDecision] = useState(initial?.decision ?? 'undecided')
  const [submitted, setSubmitted] = useState<boolean | null>(initial?.submitted ?? null)
  const [result, setResult] = useState<string>(initial?.result ?? '')
  const [ourRank, setOurRank] = useState<string>(initial?.ourRank ? String(initial.ourRank) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const save = async () => {
    setError(null)
    setSaved(false)
    setBusy(true)
    try {
      const res = await fetch(`/api/rfp/cases/${caseId}/outcome`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          decision,
          submitted,
          result: result || null,
          ourRank: ourRank ? Number(ourRank) : null,
        }),
      })
      if (!res.ok) { setError(RFP_COMMON.error); return }
      setSaved(true)
    } catch {
      setError(RFP_COMMON.error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <span className="label">{RFP_RADAR.outcomeTitle}</span>
      {error && <FormErrorBanner message={error} />}
      {/* 자동 수집이 사람이 적은 값을 안 덮는다는 사실을 화면이 보여 준다 */}
      {initial?.source && <NbBadge status="note">{initial.source}</NbBadge>}

      <div className="field">
        <label className="label" htmlFor="o-decision">{RFP_RADAR.decision}</label>
        <select id="o-decision" className="input-field" value={decision} onChange={(e) => setDecision(e.target.value)}>
          {DECISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      <div className="field">
        <label className="label" htmlFor="o-submitted">{RFP_RADAR.submitted}</label>
        <select
          id="o-submitted"
          className="input-field"
          value={submitted === null ? '' : String(submitted)}
          onChange={(e) => setSubmitted(e.target.value === '' ? null : e.target.value === 'true')}
        >
          <option value="">{RFP_COMMON.none}</option>
          <option value="true">{RFP_COMMON.yes}</option>
          <option value="false">{RFP_COMMON.no}</option>
        </select>
      </div>

      <div className="field">
        <label className="label" htmlFor="o-result">{RFP_RADAR.result}</label>
        <select id="o-result" className="input-field" value={result} onChange={(e) => setResult(e.target.value)}>
          <option value="">{RFP_COMMON.none}</option>
          {RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      <div className="field">
        <label className="label" htmlFor="o-rank">{RFP_RADAR.ourRank}</label>
        {/* 안 냈으면 순위를 못 적는다 — 서버도 같은 판단을 한다 */}
        <input
          id="o-rank"
          className="input-field"
          value={ourRank}
          disabled={submitted === false}
          onChange={(e) => setOurRank(e.target.value.replace(/[^0-9]/g, ''))}
        />
      </div>

      <NbButton onClick={() => void save()} disabled={busy}>{RFP_RADAR.save}</NbButton>
      {saved && <NbBadge status="done">{RFP_COMMON.save}</NbBadge>}
    </section>
  )
}
