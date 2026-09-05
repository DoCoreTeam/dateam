'use client'

/**
 * 지난 회의에서 사람 찾기 — 후보를 보여 주고 사람이 고른다.
 *
 * 자동으로 담지 않는다(§5-3 추출/제안형). 세 층으로 나눠 보여 주는 이유는
 * 「전부 어렵다」로 보이면 아무것도 안 하게 되기 때문이다 —
 * 실측으로 회의 18건 중 회사가 이어진 것이 1건뿐이었던 상태가 그 결과였다.
 */

import { useCallback, useEffect, useState } from 'react'
import { UserPlus, Link2, HelpCircle, EyeOff } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import NbButton from '@/components/ui/nb/NbButton'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import { SkelList } from '@/components/ui/LoadingSkeleton'
import { REASON_LABEL } from '@/lib/crm/link/attendee-link'
import { failedTo, SERVICE_LABEL } from '@/lib/terms'
import { SWEEP_TIER_LABEL, SWEEP_TIER_ORDER, type SweepRow, type SweepTier }
  from '@/lib/meeting/attendee-sweep'
import { sweepMyNotes, applyAttendeeLinks, type SweepView } from '../attendee-actions'
import styles from './attendee-sweep.module.css'

/** 아이콘은 화면의 몫이다 — 말은 lib 의 SSOT 가 정한다(§0-2) */
function tierIcon(tier: SweepTier) {
  if (tier === 'link') return <Link2 size={15} />
  if (tier === 'review') return <HelpCircle size={15} />
  return <EyeOff size={15} />
}

export default function AttendeeSweepClient() {
  const [view, setView] = useState<SweepView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<{ linked: number; created: number; failed: number } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await sweepMyNotes()
      if (!res.ok) { setError(res.error); return }
      setView(res.view)
      // 「이어도 되는 것」은 미리 골라 둔다 — 판단할 게 없는 것까지 손이 가면 안 된다
      setChosen(new Set(res.view.link.map((r) => r.key)))
    } catch {
      setError(failedTo('회의노트', '살펴보지'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const toggle = (key: string) => {
    setChosen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const apply = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await applyAttendeeLinks(Array.from(chosen))
      if (!res.ok) { setError(res.error ?? failedTo('고른 사람', '잇지')); return }
      setDone({ linked: res.linked, created: res.created, failed: res.failed.length })
      await load()
    } catch {
      setError(failedTo('고른 사람', '잇지'))
    } finally {
      setSaving(false)
    }
  }

  const back = { href: '/meeting-notes', label: '회의노트' }

  if (loading) {
    return (
      <>
        <PageHeader eyebrow="회의노트" title="지난 회의에서 사람 찾기" back={back} />
        <SkelList />
      </>
    )
  }

  if (error) {
    return (
      <>
        <PageHeader eyebrow="회의노트" title="지난 회의에서 사람 찾기" back={back} />
        <ErrorState message={error} onRetry={() => void load()} />
      </>
    )
  }

  const total = (view?.link.length ?? 0) + (view?.review.length ?? 0)
  const choosable = new Set([...(view?.link ?? []), ...(view?.review ?? [])].map((r) => r.key))
  const chosenCount = Array.from(chosen).filter((k) => choosable.has(k)).length

  return (
    <>
      <PageHeader
        eyebrow="회의노트"
        title="지난 회의에서 사람 찾기"
        description={`회의 ${view?.noteCount ?? 0}건을 살펴봤어요. 고른 사람만 ${SERVICE_LABEL.crm} 인물로 이어집니다.`}
        back={back}
      />

      {done && (
        <div className={styles.done} role="status">
          <strong>{done.created > 0 ? `인물 ${done.created}명을 새로 만들고 ` : ''}{done.linked}건을 이었어요.</strong>
          {done.failed > 0 && <span className={styles.doneWarn}> · {done.failed}건은 담지 못했어요.</span>}
        </div>
      )}

      {view?.candidatesTruncated && (
        <div className={styles.warn} role="status">
          {/* 자른 것을 조용히 넘기면 있는 사람을 「없다」로 판정해 같은 사람이 한 벌 더 생긴다 */}
          {SERVICE_LABEL.crm} 인물이 많아 일부만 대조했어요. 「확인이 필요한 것」에 이미 등록된 분이 섞여 있을 수 있어요.
        </div>
      )}

      {!view?.crmAvailable && (
        <div className={styles.warn} role="status">
          {/* 「없다」가 아니라 「못 읽었다」다 — 뭉개면 사용자가 CRM 이 비었다고 읽는다 */}
          {failedTo(SERVICE_LABEL.crm, '읽지', '잠시 후 다시 열어 주세요.')}
        </div>
      )}

      {total === 0 && (view?.drop.length ?? 0) === 0 ? (
        <EmptyState
          title="이을 사람이 아직 없어요"
          description="회의노트 참석자에 이름을 적어 두면 여기서 인물로 이어 드려요."
          icon={<UserPlus size={24} />}
        />
      ) : (
        <>
          {SWEEP_TIER_ORDER.map((tier) => {
            const rows = view?.[tier] ?? []
            if (rows.length === 0) return null
            return (
              <section key={tier} className={styles.section}>
                <h2 className={`${styles.sectionHead} ${styles[tier]}`}>
                  {tierIcon(tier)}
                  <span className={styles.sectionTitle}>{SWEEP_TIER_LABEL[tier].title}</span>
                  <span className={styles.sectionCount}>{rows.length}명</span>
                </h2>
                <p className={styles.sectionDesc}>{SWEEP_TIER_LABEL[tier].desc}</p>
                <ul className={styles.list}>
                  {rows.map((r) => (
                    <Row key={r.key} row={r} tier={tier}
                      checked={chosen.has(r.key)}
                      onToggle={() => toggle(r.key)} />
                  ))}
                </ul>
              </section>
            )
          })}

          <div className={styles.bar}>
            <span className={styles.barCount}>
              {chosenCount}명 선택 <span className={styles.barTotal}>/ {total}명</span>
            </span>
            <NbButton onClick={() => void apply()} disabled={saving || chosenCount === 0}>
              {saving ? '반영 중…' : '고른 사람 잇기'}
            </NbButton>
          </div>
        </>
      )}
    </>
  )
}

function Row({ row, tier, checked, onToggle }: {
  row: SweepRow; tier: SweepTier; checked: boolean; onToggle: () => void
}) {
  const d = row.decision
  const known = d.people[0]
  return (
    <li className={styles.item}>
      <label className={styles.label}>
        <input type="checkbox" className={styles.check}
          checked={checked} onChange={onToggle} disabled={tier === 'drop'} />
        <span className={styles.body}>
          <span className={styles.raw}>{row.raw}</span>
          <span className={styles.meta}>
            {/* 왜 이 층인지 화면이 말한다 — 이유 없이 물으면 사람은 무엇을 볼지 모른다 */}
            <span className={`${styles.reason} ${styles[`r_${tier}`]}`}>{REASON_LABEL[d.reason]}</span>
            {row.parsed.kind === 'person' && (
              <span className={styles.parsed}>
                {row.parsed.company ? `${row.parsed.company} · ` : ''}
                {row.parsed.name}
                {row.parsed.title ? ` ${row.parsed.title}` : ''}
              </span>
            )}
            {known && (
              <span className={styles.known}>
                CRM: {known.name}
                {known.companyName ? ` · ${known.companyName}` : ''}
                {known.title ? ` · ${known.title}` : ''}
              </span>
            )}
          </span>
          <span className={styles.notes}>
            {row.notes.map((n) => n.title).join(' · ')}
          </span>
        </span>
      </label>
    </li>
  )
}
