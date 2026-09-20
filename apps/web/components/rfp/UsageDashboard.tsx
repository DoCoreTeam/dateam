'use client'

// 사용량과 요금제.
//
// **숫자를 이름 없이 두지 않는다.** 「0」과 「37」이 나란히 떠 있으면
// 무엇이 0이고 무엇이 37인지 화면이 말해 주지 않는 것이다.

import SettingsCard from '@/components/ui/settings/SettingsCard'
import { toneFromStatusKey } from '@/components/ui/settings/StatusPill'
import { RFP_ADMIN } from '@/lib/rfp/terms'
import { BUDGET_WARN_RATIO } from '@/lib/rfp/notify/notify'
import type { Plan, UsageSummary } from '@/lib/rfp/tenant/usage'
import styles from '@/app/(rfp)/rfp.module.css'

export interface UsageDashboardProps {
  plan: Plan | null
  usage: UsageSummary
  members: number
  orgName: string
}

export default function UsageDashboard({ plan, usage, members, orgName }: UsageDashboardProps) {
  const limit = plan?.monthlyAiKrw ?? null
  const ratio = limit && limit > 0 ? usage.costKrw / limit : 0
  const near = ratio >= BUDGET_WARN_RATIO

  return (
    <SettingsCard
      title={orgName}
      description={`${RFP_ADMIN.usagePeriod} ${usage.period}`}
      headingLevel={2}
      status={plan ? { tone: toneFromStatusKey('note'), label: plan.name } : undefined}
    >
      <div className={styles.statGrid}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>{RFP_ADMIN.usageCost}</span>
          <span className={styles.statValue} style={near ? { color: 'var(--danger)' } : undefined}>
            {Math.round(usage.costKrw).toLocaleString()}
            <span className={styles.statUnit}>{RFP_ADMIN.unitKrw}</span>
          </span>
        </div>

        {limit !== null && (
          <div className={styles.stat}>
            <span className={styles.statLabel}>{RFP_ADMIN.usageLimit}</span>
            <span className={styles.statValue}>
              {limit.toLocaleString()}
              <span className={styles.statUnit}>{RFP_ADMIN.unitKrw}</span>
            </span>
          </div>
        )}

        <div className={styles.stat}>
          <span className={styles.statLabel}>{RFP_ADMIN.usageMembers}</span>
          <span className={styles.statValue}>
            {members}
            <span className={styles.statUnit}>
              {RFP_ADMIN.unitPeople}
              {plan?.maxMembers !== null && plan?.maxMembers !== undefined && ` / ${plan.maxMembers}`}
            </span>
          </span>
        </div>

        {Object.entries(usage.byKind).map(([kind, v]) => (
          <div key={kind} className={styles.stat}>
            <span className={styles.statLabel}>{kind}</span>
            <span className={styles.statValue}>
              {v.units.toLocaleString()}
              <span className={styles.statUnit}>{RFP_ADMIN.unitCount}</span>
            </span>
          </div>
        ))}
      </div>
    </SettingsCard>
  )
}
