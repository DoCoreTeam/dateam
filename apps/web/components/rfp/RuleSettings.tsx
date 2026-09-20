'use client'

// 이상 조항 규칙 열두 개 — 켜고 끌 수 있고, **켠 것이 실제로 남는다**.
//
// 예전에는 `setEnabled` 로 화면 상태만 바꾸고 저장 요청이 0건이었다(실측 2026-09-16).
// 사용자는 켠 줄 알고, 우리는 안 켜진 채로 돌고, 다음에 들어오면 꺼져 있었다.
//
// **실패하면 되돌린다.** 낙관적으로 먼저 켜 두는 것은 반응이 빨라서지 켜졌다고 우기려는
// 것이 아니다. 창구가 아니라고 하면 스위치를 원래대로 돌리고 그 사실을 말한다 —
// 안 그러면 화면만 켜진 채로 예전과 똑같아진다.
//
// 줄이 붙어 있으면 열두 개가 한 덩어리로 보인다. 구분선과 여백으로 한 줄씩 읽히게 한다.

import { useState } from 'react'
import SettingsCard from '@/components/ui/settings/SettingsCard'
import StatusPill, { toneFromStatusKey } from '@/components/ui/settings/StatusPill'
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
  const [saving, setSaving] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const on = rules.filter((r) => enabled[r.id] ?? true).length

  async function toggle(id: string) {
    const next = !(enabled[id] ?? true)
    setEnabled((prev) => ({ ...prev, [id]: next }))
    setSaving(id)
    setFailed(null)
    try {
      const res = await fetch('/api/rfp/rules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule_id: id, enabled: next }),
      })
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      // 되돌린다. 화면만 켜진 채로 두면 저장 창구가 없던 때와 똑같아진다
      setEnabled((prev) => ({ ...prev, [id]: !next }))
      setFailed(RFP_ADMIN.ruleSaveFailed)
    } finally {
      setSaving(null)
    }
  }

  return (
    <SettingsCard
      title={RFP_ADMIN.rules}
      headingLevel={2}
      status={{ tone: toneFromStatusKey('note'), label: `${on} / ${rules.length}` }}
    >
      {failed && (
        <p role="alert" className={styles.sectionDesc} style={{ color: 'var(--danger)' }}>{failed}</p>
      )}

      <div className={styles.ruleList}>
        {rules.map((r) => (
          <label key={r.id} className={styles.ruleItem}>
            <input
              type="checkbox"
              checked={enabled[r.id] ?? true}
              disabled={saving === r.id}
              onChange={() => { void toggle(r.id) }}
            />
            <span className={`${styles.ruleName} ${styles.tight}`}>
              <span style={{ fontWeight: 600 }}>{r.title}</span>
              <span className={styles.sectionDesc}>
                {saving === r.id ? RFP_ADMIN.ruleSaving : r.id}
              </span>
            </span>
            <StatusPill tone={toneFromStatusKey(r.grade === 'confirmed' ? 'blocker' : 'note')}>
              {ANOMALY_GRADE_LABEL[r.grade === 'confirmed' ? 'confirmed' : 'suspect']}
            </StatusPill>
            <StatusPill tone={toneFromStatusKey('doing')}>
              {ANOMALY_SEVERITY_LABEL[r.severity as AnomalySeverity]}
            </StatusPill>
          </label>
        ))}
      </div>
    </SettingsCard>
  )
}
