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
 * 그래서 손잡이를 하나로 모았다. 상태는 나만 보기와 팀 공개 둘이다(2026-10-27, 「기록만」은
 * 「나만 보기」와 같은 것이라 합쳤다). 무엇을 바꿀지는 서버가 정한다(`lib/meeting/share-state.ts`).
 *
 * ## 지키는 것
 *   ① CRM 멤버가 아니면 아무것도 안 보인다 — 못 쓰는 버튼을 보여 주지 않는다
 *   ② **각 선택이 누구에게 보이는지 그 자리에서 말한다** — 이걸 안 말한 게 사고였다
 *   ③ 나만 보기로 내려도 미팅은 지워지지 않는다, 읽는 범위만 좁아지므로 확인창이 없다
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Briefcase, ExternalLink, Lock, Eye, ChevronDown } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbModal from '@/components/ui/nb/NbModal'
import InlineError from '@/components/ui/InlineError'
import AXDotLoader from '@/components/ui/AXDotLoader'
import RecordPickerField, { type RecordOption } from '@/components/ui/RecordPicker'
import { searchCompanies, searchDeals } from '@/lib/crm/ui/record-search'
import {
  CHOOSABLE_SHARE_STATES, SHARE_STATE_LABEL, SHARE_STATE_HINT, readShareState,
  type MeetingShareState,
} from '@/lib/meeting/share-state'
import { type NoteVisibility } from '@/lib/meeting/note-visibility'
import { failedTo } from '@/lib/terms'
import { useEscClose } from '@/lib/use-esc-close'
import styles from './crm-share.module.css'

/** 아직 모름 → CRM 을 못 씀 → 정할 수 있음. 상태를 섞으면 카드가 깜빡인다 */
type Phase = 'loading' | 'no-access' | 'ready'

const ICON: Record<MeetingShareState, React.ReactNode> = {
  PRIVATE: <Lock size={13} aria-hidden />,
  TEAM: <Eye size={13} aria-hidden />,
}

export default function CrmPublishCard({ noteId, visibility }: {
  noteId: string
  /**
   * 서버가 이미 아는 공개 범위. 이걸 받으면 **첫 렌더부터** 배지를 그릴 수 있다 —
   * 예전에는 왕복이 끝날 때까지 `null` 이라 뒤늦게 나타났고, 그건 「없다」로 읽혔다.
   */
  visibility?: NoteVisibility
}) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('loading')
  const [state, setState] = useState<MeetingShareState>(() => readShareState(visibility))
  /** 배지를 눌러 펼친 상태 — 자리를 늘 차지하지 않으면서 한 번에 닿는다 */
  const [open, setOpen] = useState(false)
  const [meetingId, setMeetingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 처음 올릴 때 묻는 모달. 올린 뒤에는 아래 팝오버의 두 칸이 같은 일을 맡는다 */
  const [picking, setPicking] = useState(false)
  const [companyId, setCompanyId] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [dealId, setDealId] = useState('')
  const [dealName, setDealName] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/meeting-notes/${noteId}/share`)
      if (!res.ok) { setPhase('no-access'); return }
      const body = await res.json()
      setState(body.state as MeetingShareState)
      setMeetingId(body.meetingId ?? null)
      setCompanyId(body.companyId ?? '')
      setCompanyName(body.companyName ?? '')
      setDealId(body.dealId ?? '')
      setDealName(body.dealName ?? '')
      setPhase('ready')
    } catch {
      // CRM 을 못 읽는 건 이 화면의 실패가 아니다 — 회의노트는 그대로 쓸 수 있어야 한다
      setPhase('no-access')
    }
  }, [noteId])

  useEffect(() => { void load() }, [load])
  useEscClose(() => setOpen(false))



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
      await load()
    } catch {
      setError('공개 범위를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * 올린 뒤에 회사·딜을 **붙이거나 바꾼다.**
   *
   * 창구는 미팅 PATCH 하나다 — 회의노트 쪽에 또 만들면 같은 값을 정하는 자리가 둘이 되고,
   * 그게 이 카드가 애초에 하나로 합쳐진 이유다. `null` 은 «비우기»이므로 빈 문자열과 구분해 보낸다.
   *
   * 바꾼 뒤 `router.refresh()` 를 부른다: 상세 화면의 메타 줄(회사 · 딜 · 영업 CRM에서 보기)은
   * **서버 컴포넌트가 그린다.** 새로고침을 안 하면 골랐는데 줄은 「회사 미정」 그대로다.
   */
  async function linkTo(field: 'companyId' | 'dealId', opt: RecordOption | null) {
    if (!meetingId || busy) return
    const prev = field === 'companyId'
      ? { id: companyId, name: companyName }
      : { id: dealId, name: dealName }
    // 화면을 먼저 바꾼다 — 왕복을 기다리면 고른 것이 잠깐 사라졌다 돌아온다
    if (field === 'companyId') { setCompanyId(opt?.id ?? ''); setCompanyName(opt?.name ?? '') }
    else { setDealId(opt?.id ?? ''); setDealName(opt?.name ?? '') }

    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/meetings/${meetingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: opt?.id ?? null }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error?.message ?? failedTo(field === 'companyId' ? '회사' : '딜', '붙이지'))
        // 되돌린다 — 안 그러면 안 붙었는데 붙은 것처럼 보인다
        if (field === 'companyId') { setCompanyId(prev.id); setCompanyName(prev.name) }
        else { setDealId(prev.id); setDealName(prev.name) }
        return
      }
      router.refresh()
    } catch {
      setError(failedTo(field === 'companyId' ? '회사' : '딜', '붙이지', '연결을 확인해 주세요.'))
      if (field === 'companyId') { setCompanyId(prev.id); setCompanyName(prev.name) }
      else { setDealId(prev.id); setDealName(prev.name) }
    } finally {
      setBusy(false)
    }
  }

  /** 고른 것을 어떻게 처리할지 — 회사·딜을 먼저 물을지 */
  function choose(next: MeetingShareState) {
    if (next === state || busy) return
    // 처음 올리는 것이면 회사·딜을 한 번 묻는다. 나중에 아래 두 칸에서 바꿔도 된다
    if (next === 'TEAM' && !meetingId) { setPicking(true); return }
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
        <ChevronDown size={13} aria-hidden className={styles.caret} />
      </button>

      {open && (
        <div className={styles.pop} role="dialog" aria-label="공개 범위">
          <div className={styles.popHead}>
            <Briefcase size={14} aria-hidden />
            <strong>공개 범위</strong>
            {meetingId && (
              <Link href={`/crm/meetings/${meetingId}`} className={styles.open}>
                영업 CRM에서 열기 <ExternalLink size={13} aria-hidden />
              </Link>
            )}
          </div>

          <div className={styles.choices} role="radiogroup" aria-label="공개 범위">
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

          {/* 고른 것이 누구에게 보이는지 그 자리에서 말한다 — 이걸 안 말한 게 사고였다 */}
          <p className={styles.hint}>{SHARE_STATE_HINT[state]}</p>

          {/*
            **붙은 것** — 올린 뒤에도 여기서 바꾼다.
            딜을 붙여야 이 회의에서 뽑은 할 일이 그 딜에 가서 선다(§I04).
            아직 안 올린 회의에는 붙일 미팅이 없으므로 이 자리도 없다.
          */}
          {meetingId && (
            <div className={styles.links}>
              <label className="label" htmlFor="link-company">회사</label>
              <RecordPickerField
                id="link-company" noun="회사" value={companyId} valueName={companyName}
                placeholder="(안 붙임)"
                onChange={(opt) => void linkTo('companyId', opt)}
                search={searchCompanies}
              />
              <label className="label" htmlFor="link-deal" style={{ marginTop: 'var(--space-3)' }}>딜</label>
              <RecordPickerField
                id="link-deal" noun="딜" value={dealId} valueName={dealName}
                placeholder="(안 붙임)"
                onChange={(opt) => void linkTo('dealId', opt)}
                search={searchDeals}
              />
              <p className={styles.hintFaint}>딜을 붙이면 이 회의에서 뽑은 할 일이 그 딜에도 섭니다.</p>
            </div>
          )}
          {/* 보는 것과 고치는 것은 다르다. 안 밝히면 팀원이 "왜 수정이 안 되지"로 겪는다 */}
          <p className={styles.hintFaint}>고치거나 지우는 건 언제나 작성한 사람만 할 수 있어요.</p>
          {error && <InlineError spaced>{error}</InlineError>}
          {busy && <AXDotLoader />}
        </div>
      )}

      {/* 처음 올릴 때만 — 회사·딜을 알면 AI 가 딜에 반영할 것을 찾아 준다 */}
      {picking && (
        <NbModal title="영업 CRM에 올리기" onClose={() => setPicking(false)}>
          {error && <InlineError spaced>{error}</InlineError>}
          <p className={styles.modalLead}>
            {SHARE_STATE_HINT.TEAM}
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

    </div>
  )
}
