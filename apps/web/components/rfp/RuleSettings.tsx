'use client'

// 이상 조항 규칙 열두 개 — 켜고 끌 수 있다.
//
// 줄이 붙어 있으면 열두 개가 한 덩어리로 보인다. 구분선과 여백으로 한 줄씩 읽히게 한다.

import { useState } from 'react'
import NbBadge from '@/components/ui/nb/NbBadge'
import { RFP_ADMIN, ANOMALY_SEVERITY_LABEL, ANOMALY_GRADE_LABEL, type AnomalySeverity } from '@/lib/rfp/terms'
import { DEFAULT_RULES, type AnomalyRule } from '@/lib/rfp/anomaly/rules'
import styles from '@/app/(rfp)/rfp.module.css'

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

  const on = rules.filter((r) => enabled[r.id] ?? true).length

  return (
    <section className="card">
      <div className={styles.sectionHead}>
        <div className={styles.between}>
          <span className={styles.sectionTitle}>{RFP_ADMIN.rules}</span>
          <NbBadge status="note">{on} / {rules.length}</NbBadge>
        </div>
      </div>

      <div className={styles.ruleList}>
        {rules.map((r) => (
          <label key={r.id} className={styles.ruleItem}>
            <input
              type="checkbox"
              checked={enabled[r.id] ?? true}
              onChange={() => setEnabled((prev) => ({ ...prev, [r.id]: !(prev[r.id] ?? true) }))}
            />
            <span className={`${styles.ruleName} ${styles.tight}`}>
              <span style={{ fontWeight: 600 }}>{r.title}</span>
              <span className={styles.sectionDesc}>{r.id}</span>
            </span>
            <NbBadge status={r.grade === 'confirmed' ? 'blocker' : 'note'}>
              {ANOMALY_GRADE_LABEL[r.grade === 'confirmed' ? 'confirmed' : 'suspect']}
            </NbBadge>
            <NbBadge status="doing">{ANOMALY_SEVERITY_LABEL[r.severity as AnomalySeverity]}</NbBadge>
          </label>
        ))}
      </div>
    </section>
  )
}
