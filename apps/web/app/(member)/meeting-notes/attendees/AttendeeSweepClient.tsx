'use client'

/**
 * 지난 회의에서 사람 찾기 — 후보를 보여 주고 사람이 고른다.
 *
 * 자동으로 담지 않는다(§5-3 추출/제안형). 세 층으로 나눠 보여 주는 이유는
 * 「전부 어렵다」로 보이면 아무것도 안 하게 되기 때문이다 —
 * 실측으로 회의 18건 중 회사가 이어진 것이 1건뿐이었던 상태가 그 결과였다.
 *
 * **이은 다음이 이 화면의 나머지 절반이다.** 예전에는 만들기(C)·잇기(U)만 있고
 * 푸는 자리가 없어서, 잘못 이으면 회의노트를 하나씩 열어 편집 모드로 들어가야 했다.
 * 지금은 「이미 이은 사람」 층에서 그 자리에서 해제한다
 * (사용자 지적 2026-09-08: 「지우고 싶은게 있으면 지울 수도 있어야 하니 CRUD 지켜」).
 */

import { useCallback, useEffect, useState } from 'react'
import { UserPlus, Link2, Link2Off, HelpCircle, EyeOff, CircleUser, AlertTriangle } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import NbButton from '@/components/ui/nb/NbButton'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import InlineError from '@/components/ui/InlineError'
import { SkelList } from '@/components/ui/LoadingSkeleton'
import { REASON_LABEL } from '@/lib/crm/link/attendee-link'
import { ACTION, countOnly, failedTo, progress, SERVICE_LABEL } from '@/lib/terms'
import {
  LINKED_SECTION_LABEL, SWEEP_TIER_LABEL, SWEEP_TIER_ORDER,
  type LinkedRow, type SweepRow, type SweepTier,
} from '@/lib/meeting/attendee-sweep'
import { sweepMyNotes, applyAttendeeLinks, unlinkAttendeePerson, type SweepView } from '../attendee-actions'
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
  /** 방금 해제한 결과 — 사라진 줄만 보면 「눌렸나?」가 된다 */
  const [unlinked, setUnlinked] = useState<{ name: string; notes: number } | null>(null)
  const [busyPersonId, setBusyPersonId] = useState<string | null>(null)

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
    setUnlinked(null)
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

  const unlink = async (row: LinkedRow) => {
    setBusyPersonId(row.personId)
    setError(null)
    setDone(null)
    try {
      const res = await unlinkAttendeePerson(row.personId, row.notes.map((n) => n.id))
      if (!res.ok) { setError(res.error ?? failedTo('연결', '해제하지')); return }
      setUnlinked({ name: row.name ?? LINKED_SECTION_LABEL.missing, notes: res.removed })
      await load()
    } catch {
      setError(failedTo('연결', '해제하지'))
    } finally {
      setBusyPersonId(null)
    }
  }

  const back = { href: '/meeting-notes', label: '회의노트' }
  const header = (
    <PageHeader
      eyebrow="회의노트"
      title="지난 회의에서 사람 찾기"
      description={view
        ? `회의 ${view.noteCount}건을 살펴봤어요. 고른 사람만 ${SERVICE_LABEL.crm} 인물로 이어집니다.`
        : undefined}
      back={back}
    />
  )

  // 처음 여는 중에만 골격을 보여 준다 — 다시 읽는 중에 목록이 통째로 사라지면 자리를 잃는다
  if (loading && !view) {
    return <>{header}<SkelList /></>
  }

  const total = (view?.link.length ?? 0) + (view?.review.length ?? 0)
  const choosable = new Set([...(view?.link ?? []), ...(view?.review ?? [])].map((r) => r.key))
  const chosenCount = Array.from(chosen).filter((k) => choosable.has(k)).length
  const linkedRows = view?.linked ?? []
  const nothingAtAll = total === 0 && (view?.drop.length ?? 0) === 0 && linkedRows.length === 0

  return (
    <>
      {header}

      {/*
        결과를 오류보다 **먼저** 그린다.
        예전에는 `if (error) return <ErrorState/>` 가 먼저 돌아가서, 잇기가 성공한 뒤
        다시 읽기가 실패하면 화면이 「회의노트를 살펴보지 못했습니다」만 말했다 —
        CRM 에는 인물이 만들어져 있는데 사용자는 아무 일도 안 일어난 줄 알고 다시 누른다.
        그러면 같은 사람이 한 벌 더 생긴다(실측 2026-09-08).
      */}
      {done && (
        <div className={styles.done} role="status">
          <strong>{done.created > 0 ? `인물 ${done.created}명을 새로 만들고 ` : ''}{done.linked}건을 이었어요.</strong>
          {done.failed > 0 && <span className={styles.doneWarn}> · {done.failed}건은 담지 못했어요.</span>}
        </div>
      )}

      {unlinked && (
        <div className={styles.done} role="status">
          <strong>{unlinked.name} 님의 연결을 회의 {countOnly('note', unlinked.notes)}에서 해제했어요.</strong>
          <span className={styles.doneNote}> 인물은 {SERVICE_LABEL.crm} 에 그대로 있어요.</span>
        </div>
      )}

      {error && (view
        ? <InlineError banner spaced onDismiss={() => setError(null)}>{error}</InlineError>
        : <ErrorState message={error} onRetry={() => void load()} />
      )}

      {view && (
        <>
          {view.candidatesTruncated && (
            <div className={styles.warn} role="status">
              {/* 자른 것을 조용히 넘기면 있는 사람을 「없다」로 판정해 같은 사람이 한 벌 더 생긴다 */}
              {SERVICE_LABEL.crm} 인물이 많아 일부만 대조했어요. 「확인이 필요한 것」에 이미 등록된 분이 섞여 있을 수 있어요.
            </div>
          )}

          {!view.crmAvailable && (
            <div className={styles.warn} role="status">
              {/* 「없다」가 아니라 「못 읽었다」다 — 뭉개면 사용자가 CRM 이 비었다고 읽는다 */}
              {failedTo(SERVICE_LABEL.crm, '읽지', '잠시 후 다시 열어 주세요.')}
            </div>
          )}

          {nothingAtAll ? (
            <EmptyState
              title="이을 사람이 아직 없어요"
              description="회의노트 참석자에 이름을 적어 두면 여기서 인물로 이어 드려요."
              icon={<UserPlus size={24} />}
            />
          ) : (
            <>
              {SWEEP_TIER_ORDER.map((tier) => {
                const rows = view[tier]
                if (rows.length === 0) return null
                return (
                  <section key={tier} className={styles.section}>
                    <h2 className={`${styles.sectionHead} ${styles[tier]}`}>
                      {tierIcon(tier)}
                      <span className={styles.sectionTitle}>{SWEEP_TIER_LABEL[tier].title}</span>
                      <span className={styles.sectionCount}>{countOnly('person', rows.length)}</span>
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

              {linkedRows.length > 0 && (
                <section className={styles.section}>
                  <h2 className={`${styles.sectionHead} ${styles.linked}`}>
                    <CircleUser size={15} />
                    <span className={styles.sectionTitle}>{LINKED_SECTION_LABEL.title}</span>
                    <span className={styles.sectionCount}>{countOnly('person', linkedRows.length)}</span>
                  </h2>
                  <p className={styles.sectionDesc}>{LINKED_SECTION_LABEL.desc}</p>
                  <ul className={styles.list}>
                    {linkedRows.map((r) => (
                      <LinkedItem key={r.personId} row={r}
                        busy={busyPersonId === r.personId}
                        disabled={busyPersonId !== null}
                        onUnlink={() => void unlink(r)} />
                    ))}
                  </ul>
                </section>
              )}

              {total > 0 && (
                <div className={styles.bar}>
                  <span className={styles.barCount}>
                    {countOnly('person', chosenCount)} 선택 <span className={styles.barTotal}>/ {countOnly('person', total)}</span>
                  </span>
                  <NbButton onClick={() => void apply()} disabled={saving || chosenCount === 0}>
                    {saving ? progress('반영') : '고른 사람 잇기'}
                  </NbButton>
                </div>
              )}
            </>
          )}
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

/**
 * 이어 둔 사람 한 줄.
 *
 * 여기는 고르는 자리가 아니라 **되돌리는 자리**라 체크박스가 없다.
 * 인물 자체를 지우는 것은 인물 화면의 몫이라 링크만 둔다 — 지우는 자리가 둘이면
 * 한쪽만 고쳐지고 그때부터 서로 다른 규칙이 된다(§2-5 (3)).
 */
function LinkedItem({ row, busy, disabled, onUnlink }: {
  row: LinkedRow; busy: boolean; disabled: boolean; onUnlink: () => void
}) {
  return (
    <li className={styles.item}>
      <div className={styles.linkedRow}>
        <span className={styles.body}>
          <span className={styles.raw}>
            {row.missing ? (
              <span className={styles.missingName}>
                <AlertTriangle size={14} /> {LINKED_SECTION_LABEL.missing}
              </span>
            ) : row.name}
          </span>
          <span className={styles.meta}>
            {row.missing ? (
              <span className={styles.missingHint}>{LINKED_SECTION_LABEL.missingHint}</span>
            ) : (
              <span className={styles.parsed}>
                {[row.companyName, row.title].filter(Boolean).join(' · ') || '소속 없음'}
              </span>
            )}
          </span>
          <span className={styles.notes}>
            {row.notes.map((n) => n.title).join(' · ')}
          </span>
        </span>
        <span className={styles.linkedActions}>
          {/* 존재하지 않는 인물로는 보내지 않는다 — 눌러도 빈 화면이 나오는 링크는 없느니만 못하다 */}
          {!row.missing && (
            <NbButton variant="ghost" href={`/crm/people/${row.personId}`}>
              인물 열기
            </NbButton>
          )}
          <NbButton variant="danger-ghost" onClick={onUnlink} disabled={disabled}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <Link2Off size={15} />
            {busy ? progress(ACTION.disconnect) : ACTION.disconnect}
          </NbButton>
        </span>
      </div>
    </li>
  )
}
