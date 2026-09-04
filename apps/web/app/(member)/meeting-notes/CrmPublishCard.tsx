'use client'

/**
 * 이 회의가 팀에게 어디까지 보이나 — **손잡이 하나**
 *
 * ## 왜 다시 만들었나
 *
 * 사용자 지적(2026-08-24) 원문:
 *   *"영업 CRM 연결 해제와 연결이 의미가 있나? 어차피 나만보기로 했을때는 변화가 있나?"*
 *
 * 둘 다 "그렇다"가 답이 아니었다. 예전 이 카드에는 **연결 / 연결 해제** 두 버튼이 있었고,
 * 작업대에는 별도로 **나만 보기 / 영업팀 공개** 스위치가 있었다. 사용자는 그 둘을
 * "팀에 보이나 안 보이나" 하나로 읽는데, 실제로는 서로 다른 것을 끊었다.
 *
 *   · 「연결 해제」 → 링크만 끊는다. **미팅도 요약도 전사도 팀에 그대로 남았다.**
 *     게다가 다시 올리면 기존 미팅을 못 찾아 **같은 회의가 두 벌**이 됐다.
 *   · 「나만 보기」 → 원본 읽기만 막는다. **CRM 사본은 그대로 보였다.**
 *
 * 그래서 손잡이를 하나로 모았다. 상태 셋 중 하나를 고르면
 * `visibility` 와 미팅 존재 여부는 서버가 알아서 맞춘다(`lib/meeting/share-state.ts`).
 *
 * ## 지키는 것
 *   ① CRM 멤버가 아니면 아무것도 안 보인다 — 못 쓰는 버튼을 보여 주지 않는다
 *   ② **각 선택이 팀에게 무엇을 보이는지 그 자리에서 말한다** — 이걸 안 말한 게 사고였다
 *   ③ 되돌릴 수 없는 쪽(나만 보기로 내리기)만 확인을 받는다
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Briefcase, ExternalLink, Lock, FileText, Eye, ChevronDown, Ban } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbModal from '@/components/ui/nb/NbModal'
import InlineError from '@/components/ui/InlineError'
import AXDotLoader from '@/components/ui/AXDotLoader'
import RecordPickerField, { type RecordOption } from '@/components/ui/RecordPicker'
import {
  CHOOSABLE_SHARE_STATES, SHARE_STATE_LABEL, SHARE_STATE_HINT, needsConfirm, initialShareState,
  type MeetingShareState,
} from '@/lib/meeting/share-state'
import { type NoteVisibility } from '@/lib/meeting/note-visibility'
import { useEscClose } from '@/lib/use-esc-close'
import styles from './crm-share.module.css'

/** 아직 모름 → CRM 을 못 씀 → 정할 수 있음. 상태를 섞으면 카드가 깜빡인다 */
type Phase = 'loading' | 'no-access' | 'ready'

const ICON: Record<string, React.ReactNode> = {
  PRIVATE: <Lock size={13} aria-hidden />,
  RECORD_ONLY: <FileText size={13} aria-hidden />,
  TEAM: <Eye size={13} aria-hidden />,
  NO_SOURCE: <Ban size={13} aria-hidden />,
}

export default function CrmPublishCard({ noteId, visibility }: {
  noteId: string
  /**
   * 서버가 이미 아는 공개 범위. 이걸 받으면 **첫 렌더부터** 배지를 그릴 수 있다 —
   * 예전에는 왕복이 끝날 때까지 `null` 이라 뒤늦게 나타났고, 그건 「없다」로 읽혔다.
   */
  visibility?: NoteVisibility
}) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [state, setState] = useState<MeetingShareState>(() => initialShareState(visibility))
  /** 배지를 눌러 펼친 상태 — 자리를 늘 차지하지 않으면서 한 번에 닿는다 */
  const [open, setOpen] = useState(false)
  const [meetingId, setMeetingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 처음 올릴 때만 회사·딜을 묻는다 — 이미 올라간 건은 미팅 화면에서 고친다 */
  const [picking, setPicking] = useState(false)
  const [companyId, setCompanyId] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [dealId, setDealId] = useState('')
  const [dealName, setDealName] = useState('')

  /** 되돌릴 수 없는 쪽으로 갈 때만 뜬다 */
  const [confirming, setConfirming] = useState<MeetingShareState | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/meeting-notes/${noteId}/share`)
      if (!res.ok) { setPhase('no-access'); return }
      const body = await res.json()
      setState(body.state as MeetingShareState)
      setMeetingId(body.meetingId ?? null)
      setPhase('ready')
    } catch {
      // CRM 을 못 읽는 건 이 화면의 실패가 아니다 — 회의노트는 그대로 쓸 수 있어야 한다
      setPhase('no-access')
    }
  }, [noteId])

  useEffect(() => { void load() }, [load])
  useEscClose(() => setOpen(false))

  const searchCompanies = useCallback(async (q: string, signal: AbortSignal): Promise<RecordOption[]> => {
    const res = await fetch(`/api/crm/companies?limit=20${q ? `&q=${encodeURIComponent(q)}` : ''}`, { signal })
    const body = await res.json()
    if (!res.ok) throw new Error(body?.error?.message ?? '회사를 불러오지 못했습니다.')
    return (body.items ?? []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }))
  }, [])

  const searchDeals = useCallback(async (q: string, signal: AbortSignal): Promise<RecordOption[]> => {
    const res = await fetch(`/api/crm/deals?limit=20${q ? `&q=${encodeURIComponent(q)}` : ''}`, { signal })
    const body = await res.json()
    if (!res.ok) throw new Error(body?.error?.message ?? '딜을 불러오지 못했습니다.')
    return (body.items ?? []).map((d: { id: string; name: string }) => ({ id: d.id, name: d.name }))
  }, [])

  async function apply(next: MeetingShareState) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/meeting-notes/${noteId}/share`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: next, companyId: companyId || null, dealId: dealId || null }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body?.error?.message ?? '공개 범위를 바꾸지 못했습니다.')
        return
      }
      setPicking(false)
      setConfirming(null)
      await load()
    } catch {
      setError('공개 범위를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  /** 고른 것을 어떻게 처리할지 — 확인이 필요한지, 회사·딜을 먼저 물을지 */
  function choose(next: MeetingShareState) {
    if (next === state || busy) return
    if (needsConfirm(state, next)) { setConfirming(next); return }
    // 처음 올리는 것이면 회사·딜을 한 번 묻는다. 나중에 골라도 되지만 지금이 가장 싸다
    if (state === 'PRIVATE') { setPicking(true); return }
    void apply(next)
  }

  /*
    CRM 을 못 쓰는 사람에게는 아무것도 안 보인다 — 못 쓰는 손잡이를 보여 주지 않는다.
    다만 **로딩 중에는 그리던 것을 계속 그린다.** 서버가 준 `visibility` 로 이미
    맞는 배지를 그리고 있으므로, 여기서 감추면 배지가 깜빡였다가 다시 나타난다.
  */
  if (phase === 'no-access') return null

  return (
    <div className={styles.wrap}>
      {/*
        배지가 **제목 옆 첫 화면**에 선다. 열자마자 "누가 볼 수 있나"가 보인다 —
        예전에는 288줄짜리 화면의 284번째 줄이라 스크롤해야 닿았다(v0.7.685).
      */}
      <button
        type="button"
        className={`${styles.badge} ${styles[`b_${state}`]}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        title={SHARE_STATE_HINT[state]}
      >
        {ICON[state]}
        <span>{SHARE_STATE_LABEL[state]}</span>
        {state !== 'NO_SOURCE' && <ChevronDown size={13} aria-hidden className={styles.caret} />}
      </button>

      {open && state !== 'NO_SOURCE' && (
        <div className={styles.pop} role="dialog" aria-label="영업팀에 보이는 범위">
          <div className={styles.popHead}>
            <Briefcase size={14} aria-hidden />
            <strong>영업팀에 보이는 범위</strong>
            {meetingId && (
              <Link href={`/crm/meetings/${meetingId}`} className={styles.open}>
                영업 CRM에서 열기 <ExternalLink size={13} aria-hidden />
              </Link>
            )}
          </div>

          <div className={styles.choices} role="radiogroup" aria-label="영업팀에 보이는 범위">
            {CHOOSABLE_SHARE_STATES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={state === s}
                className={`${styles.choice}${state === s ? ` ${styles.on}` : ''}`}
                onClick={() => choose(s)}
                disabled={busy}
              >
                {ICON[s]}
                <span className={styles.choiceLabel}>{SHARE_STATE_LABEL[s]}</span>
              </button>
            ))}
          </div>

          {/* 고른 것이 팀에게 무엇을 보이는지 그 자리에서 말한다 — 이걸 안 말한 게 사고였다 */}
          <p className={styles.hint}>{SHARE_STATE_HINT[state]}</p>
          {/* 보는 것과 고치는 것은 다르다. 안 밝히면 팀원이 "왜 수정이 안 되지"로 겪는다 */}
          <p className={styles.hintFaint}>고치거나 지우는 건 언제나 작성한 사람만 할 수 있어요.</p>
          {error && <InlineError spaced>{error}</InlineError>}
          {busy && <AXDotLoader />}
        </div>
      )}

      {state === 'NO_SOURCE' && open && (
        <div className={styles.pop} role="dialog" aria-label="영업팀에 보이는 범위">
          <p className={styles.hint}>{SHARE_STATE_HINT.NO_SOURCE}</p>
        </div>
      )}

      {/* 처음 올릴 때만 — 회사·딜을 알면 AI 가 딜에 반영할 것을 찾아 준다 */}
      {picking && (
        <NbModal title="영업 CRM에 올리기" onClose={() => setPicking(false)}>
          {error && <InlineError spaced>{error}</InlineError>}
          <p className={styles.modalLead}>
            올리면 이 회의의 제목·요약·전사가 <strong>영업 CRM 멤버에게 보입니다.</strong>
            고치거나 지우는 건 계속 나만 할 수 있어요.
          </p>

          <label className="label" htmlFor="publish-company">회사</label>
          <RecordPickerField
            id="publish-company" noun="회사" value={companyId} valueName={companyName}
            placeholder="(나중에 골라도 됩니다)"
            onChange={(opt) => { setCompanyId(opt?.id ?? ''); setCompanyName(opt?.name ?? '') }}
            search={searchCompanies}
          />

          <label className="label" htmlFor="publish-deal" style={{ marginTop: 'var(--space-3)' }}>딜</label>
          <RecordPickerField
            id="publish-deal" noun="딜" value={dealId} valueName={dealName}
            placeholder="(나중에 골라도 됩니다)"
            onChange={(opt) => { setDealId(opt?.id ?? ''); setDealName(opt?.name ?? '') }}
            search={searchDeals}
          />

          <div className={styles.modalActions}>
            <NbButton variant="ghost" onClick={() => setPicking(false)}>취소</NbButton>
            <NbButton onClick={() => void apply('TEAM')} disabled={busy}>
              {busy ? '올리는 중…' : '올리기'}
            </NbButton>
          </div>
        </NbModal>
      )}

      {/* 팀이 보던 것이 사라지는 일이라 무엇이 없어지는지 먼저 말한다 */}
      {confirming && (
        <NbModal title="영업 CRM에서 내릴까요?" onClose={() => setConfirming(null)}>
          {error && <InlineError spaced>{error}</InlineError>}
          <p className={styles.modalLead}>
            영업 CRM의 이 미팅이 <strong>목록에서 사라집니다.</strong>
            올려 둔 요약·전사도 팀에게 더 이상 보이지 않아요.
            <br /><br />
            지운 미팅은 <strong>30일 안에 되살릴 수 있습니다.</strong>
            AI가 이미 딜에 반영한 것은 팀이 본 사실이라 그대로 남습니다.
          </p>
          <p className={styles.modalAlt}>
            원본만 잠그고 <strong>요약·전사는 팀에 남겨 두려면</strong> 「{SHARE_STATE_LABEL.RECORD_ONLY}」을 고르세요.
          </p>

          <div className={styles.modalActions}>
            <NbButton variant="ghost" onClick={() => setConfirming(null)}>취소</NbButton>
            <NbButton variant="ghost" onClick={() => void apply('RECORD_ONLY')} disabled={busy}>
              {SHARE_STATE_LABEL.RECORD_ONLY}으로 두기
            </NbButton>
            <NbButton onClick={() => void apply(confirming)} disabled={busy}>
              {busy ? '내리는 중…' : '영업 CRM에서 내리기'}
            </NbButton>
          </div>
        </NbModal>
      )}
    </div>
  )
}
