'use client'

// 이상 조항 규칙 — 열두 개가 목록으로 보이고 켜고 끌 수 있다.
//
// 규칙 값이 코드에 박혀 있으면 관리자가 못 고치고, 못 고치면 규칙이 곧 낡는다.

import { useState } from 'react'
import NbBadge from '@/components/ui/nb/NbBadge'
import { RFP_ADMIN, ANOMALY_SEVERITY_LABEL, ANOMALY_GRADE_LABEL, type AnomalySeverity } from '@/lib/rfp/terms'
import { DEFAULT_RULES, type AnomalyRule } from '@/lib/rfp/anomaly/rules'

export interface RuleSettingsProps {
  /** DB 에 저장된 규칙. 없으면 기본값이 보인다 */
  saved: AnomalyRule[]
}

export default function RuleSettings({ saved }: RuleSettingsProps) {
  const byId = new Map(saved.map((r) => [r.id, r]))
  const rules = DEFAULT_RULES.map((d) => byId.get(d.id) ?? d)
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    () => Object.fromEntries(rules.map((r) => [r.id, r.enabled])),
  )

  return (
    <section className="card">
      <h2 className="label">{RFP_ADMIN.rules}</h2>
      <ul>
        {rules.map((r) => (
          <li key={r.id}>
            <label>
              <input
                type="checkbox"
                checked={enabled[r.id] ?? true}
                onChange={() => setEnabled((prev) => ({ ...prev, [r.id]: !(prev[r.id] ?? true) }))}
              />
              <span style={{ marginLeft: 'var(--space-2)' }}>{r.id} {r.title}</span>
            </label>
            <NbBadge status="note">{ANOMALY_GRADE_LABEL[r.grade === 'confirmed' ? 'confirmed' : 'suspect']}</NbBadge>
            <NbBadge status="doing">{ANOMALY_SEVERITY_LABEL[r.severity as AnomalySeverity]}</NbBadge>
          </li>
        ))}
      </ul>
    </section>
  )
}
