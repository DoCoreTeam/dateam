'use client'

// 사용량과 요금제 — 이번 달 얼마 썼나.
//
// 상한에 가까워지는 것을 미리 보여 준다. 넘고 나서 막히면
// 사용자는 그때 분석을 못 돌린다.

import NbBadge from '@/components/ui/nb/NbBadge'
import { RFP_ADMIN, ORG_ROLE_LABEL } from '@/lib/rfp/terms'
import { BUDGET_WARN_RATIO } from '@/lib/rfp/notify/notify'
import type { Plan, UsageSummary } from '@/lib/rfp/tenant/usage'

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
    <section className="card">
      <h2 className="label">{RFP_ADMIN.usage}</h2>
      <p>{orgName}</p>
      {plan && <NbBadge status="note">{plan.name}</NbBadge>}

      <p>
        <span className="label">{usage.period}</span>
        {' '}
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600, color: near ? 'var(--danger)' : 'var(--text)' }}>
          {Math.round(usage.costKrw).toLocaleString()}
        </span>
        {limit !== null && <span style={{ color: 'var(--text-faint)' }}> / {limit.toLocaleString()}</span>}
      </p>

      <ul>
        {Object.entries(usage.byKind).map(([kind, v]) => (
          <li key={kind}>
            <span>{kind}</span>
            <span style={{ color: 'var(--text-faint)' }}> {v.units} {Math.round(v.costKrw).toLocaleString()}</span>
          </li>
        ))}
      </ul>

      <p>
        <span className="label">{RFP_ADMIN.members}</span> {members}
        {plan?.maxMembers !== null && plan?.maxMembers !== undefined && (
          <span style={{ color: 'var(--text-faint)' }}> / {plan.maxMembers}</span>
        )}
      </p>
      <p style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-xs)' }}>
        {ORG_ROLE_LABEL.admin} · {ORG_ROLE_LABEL.member} · {ORG_ROLE_LABEL.viewer}
      </p>
    </section>
  )
}
