'use client'

/**
 * 그 날의 작업대 — **날짜를 누르면 할 수 있는 일이 전부 여기 있다.**
 *
 * 사용자 지시(2026-08-27): *"캘린더에 날짜를 누르면 할 수 있는 모든 펑션이 나오는거고,
 * CRM에 접속은 뭔가를 세부 확인하고 할때 하는거고 ... 화면전환이 많이 안일어나길 바래"*.
 *
 * 예전 날짜 패널에는 「일정」과 「작성」 둘뿐이었다. 미팅을 시작하려면 CRM 메뉴를 찾아
 * 들어가야 했고, 그건 회의 직전에 아무도 하지 않는다.
 *
 * **어느 시스템의 일인지 배지로 밝힌다** — 같은 지시의 다른 half("CRM은 CRM에서,
 * 개인 업무는 업무관리, CI는 CI쪽으로"). 모른 채 누르면 자기가 어디에 뭘 남겼는지 잃는다.
 *
 * 무엇이 보이는지는 여기서 정하지 않는다 — `lib/calendar/day-actions.ts` 가 SSOT 다.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarPlus, Mic, NotebookPen, CheckSquare, Sparkles } from 'lucide-react'
import { dayActions, type DayAction } from '@/lib/calendar/day-actions'
import { startMeeting, meetingHref } from '@/lib/crm/ui/start-meeting'
import { kstTodayKey } from '@/lib/datetime/kst'
import InlineError from '@/components/ui/InlineError'
import styles from './day-workbench.module.css'

const ICON: Record<string, React.ReactNode> = {
  meeting: <Mic size={15} aria-hidden />,
  event: <CalendarPlus size={15} aria-hidden />,
  daily: <NotebookPen size={15} aria-hidden />,
  crmTask: <CheckSquare size={15} aria-hidden />,
  ci: <Sparkles size={15} aria-hidden />,
}

interface Props {
  /** YYYY-MM-DD (KST) */
  date: string
  /** 「새 일정」은 화면을 옮기지 않고 이 자리에서 연다 — 상위가 모달을 쥔다 */
  onNewEvent: () => void
}

export default function DayWorkbench({ date, onNewEvent }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const actions = dayActions(date, kstTodayKey())

  async function run(a: DayAction) {
    setError(null)
    if (a.kind === 'inline') { onNewEvent(); return }
    if (a.kind === 'link') { if (a.href) router.push(a.href); return }

    // 미팅 — 제목·시각을 묻지 않고 만들고 곧장 작업대로 간다(start-meeting SSOT)
    setBusy(a.key)
    try {
      const { id } = await startMeeting({ dateKey: date })
      router.push(meetingHref(id))
    } catch (e) {
      setError(e instanceof Error ? e.message : '미팅을 만들지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className={styles.bar} aria-label="이 날 할 수 있는 것">
      <div className={styles.row}>
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            className={styles.action}
            data-surface={a.surface}
            onClick={() => void run(a)}
            disabled={busy === a.key}
            title={a.hint}
          >
            {ICON[a.key]}
            <span className={styles.label}>{busy === a.key ? '만드는 중…' : a.label}</span>
            {/* 어느 시스템의 일인지 — 누르기 전에 알아야 한다 */}
            <span className={styles.surface}>{a.surfaceLabel}</span>
          </button>
        ))}
      </div>
      <InlineError>{error}</InlineError>
    </section>
  )
}
