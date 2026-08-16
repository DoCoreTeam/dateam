'use client'

// 리드 이관 (dacrm 정정판)
//
// 기존 "프로젝트관리"에 리드가 1,500건 넘게 쌓여 있었는데 CRM 에 갈 곳이 없었다.
// 그래서 두 시스템을 나란히 두고 있었고, 사용자는 같은 거래처를 두 곳에서 보게 됐다.
//
// 여기가 그 다리다. 다만 **한 번에 다 옮기지 않는다** —
// 1,500건을 밀어 넣으면 회사 목록이 죽은 리드로 뒤덮이고, 되돌릴 방법이 없다.
// 위에서부터 보고, 쓸 만한 것만, 하나씩 옮긴다.

import { useCallback, useEffect, useState } from 'react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { kstDateKey } from '@/lib/datetime/kst'
import styles from './inbox.module.css'

interface Plan {
  ok: boolean
  reason?: string
  companyName?: string
  personName?: string | null
  dealName?: string | null
  amountMinor?: string | null
}

interface LeadRow {
  id: string
  createdAt: string
  status: string
  plan: Plan
  parsed: { deal_description?: string | null; fit_score?: number | null } | null
}

export default function LeadImport() {
  const [items, setItems] = useState<LeadRow[]>([])
  const [pending, setPending] = useState(0)
  const [migrated, setMigrated] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/lead-import')
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '리드를 불러오지 못했습니다.'); return }
      setItems(body.items ?? [])
      setPending(body.pending ?? 0)
      setMigrated(body.migrated ?? 0)
    } catch {
      setError('리드를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function move(leadId: string, createDeal: boolean) {
    setBusy(leadId)
    setError(null)
    try {
      const res = await fetch('/api/crm/lead-import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, createDeal }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '옮기지 못했습니다.'); return }
      await load()
    } catch {
      setError('옮기지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(null)
    }
  }

  // 옮길 게 없으면 이 카드 자체를 안 보여 준다 — 다 끝난 이관이 화면을 계속 차지하면 안 된다
  if (!loading && pending === 0 && migrated === 0) return null

  return (
    <section className={`card ${styles.leadCard}`}>
      <div className={styles.leadHead}>
        <h2 className={styles.leadTitle}>옛 리드 옮기기</h2>
        <NbBadge status={pending === 0 ? 'done' : 'planned'}>
          {pending === 0 ? '다 옮겼어요' : `${pending.toLocaleString('ko-KR')}건 남음`}
        </NbBadge>
        <NbButton variant="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? '접기' : '보기'}
        </NbButton>
      </div>

      <p className={styles.leadHint}>
        예전 프로젝트관리에 쌓인 리드입니다. 쓸 만한 것만 골라 옮기세요 —
        옮긴 것은 회사·담당자로 들어가고, 원문은 활동에 남습니다.
        {migrated > 0 && ` 지금까지 ${migrated.toLocaleString('ko-KR')}건 옮겼어요.`}
      </p>

      <FormErrorBanner message={error} />

      {!open ? null : loading ? (
        <AXDotLoader />
      ) : items.length === 0 ? (
        <EmptyState
          title="옮길 리드가 없어요"
          description="예전 리드를 모두 정리했습니다."
        />
      ) : (
        <ul className={styles.leadList}>
          {items.map((l) => (
            <li key={l.id} className={styles.leadItem}>
              <div className={styles.leadMain}>
                <span className={styles.leadName}>
                  {l.plan.ok ? l.plan.companyName : '(회사 이름 없음)'}
                </span>
                {l.plan.personName && <span className={styles.leadSub}>· {l.plan.personName}</span>}
                <span className={styles.leadDate}>{kstDateKey(l.createdAt)}</span>
              </div>

              {l.parsed?.deal_description && (
                <p className={styles.leadDesc}>{l.parsed.deal_description}</p>
              )}

              {!l.plan.ok ? (
                <p className={styles.leadBlocked}>{l.plan.reason}</p>
              ) : (
                <div className={styles.leadActions}>
                  <NbButton variant="ghost" disabled={busy === l.id} onClick={() => void move(l.id, false)}>
                    회사만 옮기기
                  </NbButton>
                  {l.plan.dealName && (
                    <NbButton disabled={busy === l.id} onClick={() => void move(l.id, true)}>
                      딜까지 만들기
                    </NbButton>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
