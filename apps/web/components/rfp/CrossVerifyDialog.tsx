'use client'

// 교차검증 대화 — **확인 전에 얼마나 드는지 보여 준다.**
//
// 숫자를 안 보여 주면 사용자는 청구서를 보고 나서야 안다.
// 그리고 「전부」를 기본으로 두지 않는다 — 실수로 큰 비용을 내게 된다.

import { useMemo, useState } from 'react'
import NbButton from '@/components/ui/nb/NbButton'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { RFP_CROSS, RFP_COMMON, estimateLine } from '@/lib/rfp/terms'
import { planCross, recommend, type Recommendation } from '@/lib/rfp/cross/estimate'

export interface CrossField {
  fieldPath: string
  label: string
  confidence: number | null
  grounded: boolean
  ruleFlagged: boolean
  conflictingMentions: number
}

export interface CrossVerifyDialogProps {
  caseId: string
  fields: CrossField[]
  vendors: { id: string; label: string }[]
  onClose: () => void
  onStarted?: () => void
}

/** DB 설정이 없을 때 쓰는 요금 — 화면이 숫자를 못 보여 주는 것보다 낫다 */
const RATE = { krwPerFieldPerVendor: 350, secondsPerVendor: 180 }

export default function CrossVerifyDialog({
  caseId, fields, vendors, onClose, onStarted,
}: CrossVerifyDialogProps) {
  const recs = useMemo<Recommendation[]>(
    () => fields.map((f) => recommend(f.fieldPath, {
      confidence: f.confidence, grounded: f.grounded,
      ruleFlagged: f.ruleFlagged, conflictingMentions: f.conflictingMentions,
    })),
    [fields],
  )

  // 권장 항목만 미리 골라 둔다 — 「전부」가 기본이면 실수로 큰 비용을 낸다
  const [picked, setPicked] = useState<string[]>(
    () => recs.filter((r) => r.recommended).map((r) => r.fieldPath),
  )
  const [pickedVendors, setPickedVendors] = useState<string[]>(() => vendors.slice(0, 2).map((v) => v.id))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const estimate = useMemo(
    () => planCross(
      recs.filter((r) => picked.includes(r.fieldPath)).map((r) => ({ ...r, recommended: true })),
      pickedVendors.length,
      RATE,
    ).estimate,
    [recs, picked, pickedVendors.length],
  )

  const start = async () => {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/rfp/cases/${caseId}/cross`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fields: picked, vendorIds: pickedVendors }),
      })
      if (!res.ok) { setError(RFP_COMMON.error); return }
      onStarted?.()
      onClose()
    } catch {
      setError(RFP_COMMON.error)
    } finally {
      setBusy(false)
    }
  }

  const toggle = (list: string[], set: (v: string[]) => void, key: string) => {
    set(list.includes(key) ? list.filter((x) => x !== key) : [...list, key])
  }

  return (
    <div className="card">
      <h2 className="label">{RFP_CROSS.title}</h2>
      <p style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>{RFP_CROSS.desc}</p>
      {error && <FormErrorBanner message={error} />}

      <fieldset>
        <legend className="label">{RFP_CROSS.pickFields}</legend>
        {fields.map((f) => {
          const rec = recs.find((r) => r.fieldPath === f.fieldPath)
          return (
            <label key={f.fieldPath} style={{ display: 'block' }}>
              <input
                type="checkbox"
                checked={picked.includes(f.fieldPath)}
                onChange={() => toggle(picked, setPicked, f.fieldPath)}
              />
              <span style={{ marginLeft: 'var(--space-2)' }}>{f.label}</span>
              {rec?.recommended && (
                <span style={{ marginLeft: 'var(--space-2)', color: 'var(--text-faint)', fontSize: 'var(--fs-xs)' }}>
                  {rec.score}
                </span>
              )}
            </label>
          )
        })}
      </fieldset>

      <fieldset>
        <legend className="label">{RFP_CROSS.pickVendors}</legend>
        {vendors.map((v) => (
          <label key={v.id} style={{ display: 'block' }}>
            <input
              type="checkbox"
              checked={pickedVendors.includes(v.id)}
              onChange={() => toggle(pickedVendors, setPickedVendors, v.id)}
            />
            <span style={{ marginLeft: 'var(--space-2)' }}>{v.label}</span>
          </label>
        ))}
      </fieldset>

      {/* 확인 전에 숫자를 보여 준다 */}
      <p className="label">{RFP_CROSS.estimate}</p>
      <p>{estimateLine(estimate.krw, Math.ceil(estimate.seconds / 60))}</p>

      <NbButton onClick={() => void start()} disabled={busy || picked.length === 0 || pickedVendors.length === 0}>
        {RFP_CROSS.confirm}
      </NbButton>
      <NbButton variant="ghost" onClick={onClose}>{RFP_CROSS.cancel}</NbButton>
    </div>
  )
}
