'use client'

// 오늘 (dacrm — 통상 CRM 의 첫 화면)
//
// **왜 이 화면이 생겼나**: `/crm` 이 인박스로 바로 넘겼는데, 인박스는
// "AI 가 찾아낸 제안을 확인하는 곳"이라 **처음 온 사람에겐 구조적으로 비어 있다.**
// 회사도 미팅도 없으니 AI 가 넣어 줄 것이 없기 때문이다.
// 가장 나중에 의미가 생기는 화면을 첫 화면으로 뒀던 셈이다.
//
// 통상의 CRM 은 첫 화면이 **"오늘 내가 뭘 해야 하나"**다
// (HubSpot Sales Workspace: 오늘의 할 일 · 다가오는 미팅 · 딜 진행).
//
// **AI 제안은 눌러야 온다.** 화면을 열 때마다 모델을 부르면 돈이 새고,
// 무엇보다 **사람이 안 볼 때도 비용이 든다.** 필요할 때 누르는 편이 정직하다.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, Clock, Inbox, PauseCircle, Sparkles, Plus, ArrowRight, Check, Circle,
} from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { KIND_LABEL, type AttentionKind, type AttentionItem } from '@/lib/crm/services/attention'
import MeetingIntakeBox from '@/components/crm/MeetingIntakeBox'
import type { TodayMeeting } from '@/lib/crm/services/today-meetings'
import styles from './today.module.css'

const ICON: Record<AttentionKind, React.ReactNode> = {
  overdue: <AlertTriangle size={14} />,
  due_today: <Clock size={14} />,
  suggestion: <Inbox size={14} />,
  stalled: <PauseCircle size={14} />,
}

interface SetupStep {
  id: string
  title: string
  why: string
  done: boolean
  status: string
  action: { label: string; href: string }
  alt?: { label: string; href: string }
}
interface Setup {
  steps: SetupStep[]
  doneCount: number
  current: string | null
}

interface AiSuggestion {
  dealId: string
  dealName: string
  action: string
  because: string
  dueInDays: number
  dueDate: string
}

export default function TodayClient() {
  const [items, setItems] = useState<AttentionItem[]>([])
  const [summary, setSummary] = useState('')
  const [total, setTotal] = useState(0)
  const [unplanned, setUnplanned] = useState(0)
  const [name, setName] = useState('')
  const [setup, setSetup] = useState<Setup | null>(null)
  const [todayMeetings, setTodayMeetings] = useState<TodayMeeting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [ai, setAi] = useState<AiSuggestion[] | null>(null)
  const [aiReason, setAiReason] = useState<string | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [applied, setApplied] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/today')
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '불러오지 못했습니다.'); return }
      const a = body.attention ?? {}
      setItems(a.items ?? [])
      setSummary(a.summary ?? '')
      setTotal(a.total ?? 0)
      setUnplanned(body.unplanned ?? 0)
      setName(body.displayName ?? '')
      setSetup(body.setup ?? null)
      setTodayMeetings(body.todayMeetings ?? [])
    } catch {
      setError('불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function askAi() {
    setAiBusy(true)
    setAiReason(null)
    try {
      const res = await fetch('/api/crm/today?ai=1')
      const body = await res.json()
      if (!res.ok) { setAiReason(body?.error?.message ?? '지금은 제안을 못 드려요.'); return }
      setAi(body.ai?.suggestions ?? [])
      setAiReason(body.ai?.reason ?? null)
    } catch {
      setAiReason('지금은 제안을 못 드려요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setAiBusy(false)
    }
  }

  /**
   * 제안을 실제 할 일로.
   *
   * **자동으로 만들지 않는다.** AI 가 만든 할 일이 목록에 그냥 쌓이면
   * 사람은 그 목록 전체를 안 믿게 된다 — 눌러서 받아들이는 것까지가 사람 몫이다.
   */
  async function accept(s: AiSuggestion) {
    setError(null)
    try {
      const res = await fetch('/api/crm/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: s.action, dealId: s.dealId, dueAt: s.dueDate }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error?.message ?? '할 일을 만들지 못했습니다.')
        return
      }
      setApplied((prev) => new Set(prev).add(s.dealId))
      void load()
    } catch {
      setError('할 일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }

  if (loading) return <AXDotLoader />
  if (error && items.length === 0 && total === 0) {
    return <ErrorState message={error} onRetry={() => void load()} />
  }

  return (
    <>
      <FormErrorBanner message={error} />

      <p className={styles.greeting}>
        {name ? `${name}님, ` : ''}
        {total > 0 ? summary : '급한 건 다 처리하셨어요.'}
      </p>

      {/*
        포착이 맨 위다.
        노트북을 펼치고 고객 앞에 앉은 사람이 가장 먼저 찾는 것은 「어디에 적지」이지
        「무엇이 밀렸지」가 아니다. 밀린 것은 그 아래에서 기다려도 된다.
      */}
      <MeetingIntakeBox todayMeetings={todayMeetings} />

      {/*
        시작하기 — 처음 온 사람이 가장 먼저 봐야 할 것.
        **다 끝나면 서버가 안 보낸다**(계속 뜨면 그때부터는 장식이다).
        순서는 업계 정설 그대로: 프로세스 → 데이터 → 운영.
      */}
      {setup && (
        <section className={`card ${styles.setup}`}>
          <div className={styles.setupHead}>
            <h2 className={styles.setupTitle}>시작하기</h2>
            <span className={styles.setupCount}>{setup.doneCount} / {setup.steps.length}</span>
          </div>

          <ol className={styles.setupList}>
            {setup.steps.map((st) => (
              <li
                key={st.id}
                className={styles.setupStep}
                data-done={st.done ? '1' : '0'}
                /* 지금 할 것 하나만 강조한다 — 넷을 다 읽게 하면 아무것도 안 한다 */
                data-current={st.id === setup.current ? '1' : '0'}
              >
                <span className={styles.setupMark}>
                  {st.done ? <Check size={14} /> : <Circle size={14} />}
                </span>
                <span className={styles.setupBody}>
                  <span className={styles.setupStepTitle}>{st.title}</span>
                  {/* 이유 없는 지시는 사람이 안 따른다 */}
                  <span className={styles.setupWhy}>{st.why}</span>
                  <span className={styles.setupStatus}>{st.status}</span>
                </span>
                {!st.done && (
                  <span className={styles.setupActions}>
                    {/* 이동이라 버튼이 아니라 링크다 — 새 탭·우클릭·키보드가 전부 된다 */}
                    <Link href={st.action.href} className="btn-primary">{st.action.label}</Link>
                    {st.alt && (
                      <Link href={st.alt.href} className="btn-ghost">{st.alt.label}</Link>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/*
        영업 규율 지표. 이 숫자가 크면 딜이 조용히 멈춰 있다는 뜻이다 —
        Pipedrive 원칙: "모든 열린 딜에는 다음 활동이 계획되어 있어야 한다".
      */}
      {unplanned > 0 && (
        <Link href="/crm/deals" className={styles.unplanned}>
          <AlertTriangle size={14} />
          <span>다음에 뭘 할지 안 정한 딜이 <strong>{unplanned}건</strong> 있어요</span>
          <ArrowRight size={14} />
        </Link>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="지금 볼 게 없어요"
          description="기한이 지난 할 일이나 확인 기다리는 제안이 생기면 여기에 뜹니다."
          icon={<Clock size={28} />}
          action={{ label: '딜 보러 가기', href: '/crm/deals' }}
        />
      ) : (
        <ul className={styles.list}>
          {items.map((it) => (
            <li key={`${it.kind}:${it.id}`}>
              <Link href={it.href} className={styles.item}>
                <span className={styles.icon} data-kind={it.kind}>{ICON[it.kind]}</span>
                <span className={styles.body}>
                  <span className={styles.title}>{it.title}</span>
                  {/* 왜 여기 떴는지 — 이유가 없으면 사람은 무시하는 법부터 배운다 */}
                  <span className={styles.reason}>{it.reason}</span>
                </span>
                <span className={styles.kind}>{KIND_LABEL[it.kind]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section className={`card ${styles.aiCard}`}>
        <div className={styles.aiHead}>
          <h2 className={styles.aiTitle}><Sparkles size={16} /> 멈춘 딜, 다음에 뭘 할까요</h2>
          <NbButton variant="ghost" onClick={() => void askAi()} disabled={aiBusy}>
            {aiBusy ? '보는 중…' : ai === null ? '물어보기' : '다시 보기'}
          </NbButton>
        </div>

        <p className={styles.aiLead}>
          한동안 아무 일도 없던 딜만 골라 봅니다. 제안은 <strong>근거와 함께</strong> 나오고,
          받아들일지는 눌러서 정하세요 — 저절로 만들어지지 않습니다.
        </p>

        {aiReason && <p className={styles.aiReason}>{aiReason}</p>}

        {ai !== null && ai.length > 0 && (
          <ul className={styles.aiList}>
            {ai.map((s) => (
              <li key={s.dealId} className={styles.aiItem}>
                <div className={styles.aiBody}>
                  <Link href={`/crm/deals/${s.dealId}`} className={styles.aiDeal}>{s.dealName}</Link>
                  <span className={styles.aiAction}>{s.action}</span>
                  {/* 근거 없는 제안은 조언이 아니라 소음이다 */}
                  <span className={styles.aiBecause}>{s.because} · {s.dueInDays}일 안에</span>
                </div>
                {applied.has(s.dealId) ? (
                  <NbBadge status="done">할 일로 만듦</NbBadge>
                ) : (
                  <NbButton variant="ghost" onClick={() => void accept(s)}>
                    <Plus size={14} /> 할 일로
                  </NbButton>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
