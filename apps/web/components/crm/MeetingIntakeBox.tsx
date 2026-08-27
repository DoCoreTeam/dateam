'use client'

// components/crm/MeetingIntakeBox.tsx — CRM 첫 화면의 포착 자리
//
// **왜 생겼나**: `/crm/today` 가 **읽기 전용**이었다(276줄 전체에 새 기록을 만드는 진입 0개).
// 미팅을 시작하려면 사이드바 → 미팅 → 「미팅 기록」 — **두 번을 더 눌러야** 받아적기가 시작됐다.
// 사용자 지시(2026-08-27): *"첫 화면에서 바로 뭔가 입력을 할 수 있어야 한다고 했어
// 관련 메뉴로 가는게 아니라 … 노트북을 펼치고 우리 서비스에 접속을 해"*
//
// 같은 제품 안에서 규칙이 갈려 있던 것도 이유다 — `(ci)` 홈은 이미 첫 화면에
// `LinkIntakeBox` 를 갖고 있는데 `(crm)` 만 없었다.
//
// **새로 만드는 것이 거의 없다.** 작업대(`MeetingWorkbench`)·녹음 프로바이더(`AppShell`)·
// 제목·시각을 안 묻는 진입(`startMeeting`)이 전부 이미 있다.
// 이 부품이 하는 일은 **그 호출을 첫 화면으로 끌어올리는 것**뿐이다.
//
// 말은 용어집이 정한다(§0-2) — 「미팅 기록」은 `MEETING_CAPTURE_LABEL` 이다.
// 만드는 행위가 아니라 **이미 일어나는 일을 받아적는 행위**라 「새 미팅」이 아니다.

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Mic, PenLine, ClipboardPaste, ArrowRight } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { startMeeting, meetingHref } from '@/lib/crm/ui/start-meeting'
import { MEETING_CAPTURE_LABEL, progress } from '@/lib/terms'
import { formatKstTime } from '@/lib/datetime/kst'
import styles from './meeting-intake.module.css'

/** 오늘 캘린더에 잡혀 있는 미팅 — 있으면 새로 만들지 않고 그것을 이어간다 */
export interface TodayMeeting {
  id: string
  title: string
  startedAt: string
  companyName: string | null
  /** 아직 아무것도 안 적힌 미팅인가 */
  empty: boolean
}

/**
 * 어느 탭으로 열 것인가.
 *
 * 셋 다 목적지는 **같은 작업대**다 — 회의 중 화면 전환을 0회로 두기 위해서다.
 * 다른 것은 처음 보이는 탭뿐이라 `?wb=` 하나로 갈린다(작업대의 기존 규약).
 */
type Entry = 'record' | 'write' | 'paste'

const ENTRY: Record<Entry, { label: string; icon: React.ReactNode; wb: string; primary?: boolean }> = {
  record: { label: '녹음 시작', icon: <Mic size={15} />, wb: 'transcript', primary: true },
  write: { label: '직접 작성', icon: <PenLine size={15} />, wb: 'memo' },
  paste: { label: '붙여넣기', icon: <ClipboardPaste size={15} />, wb: 'transcript' },
}

/** 지난 날짜에는 녹음이 아니라 작성으로 연다 — 이미 끝난 회의를 녹음할 수는 없다 */
const ENTRY_ORDER: Entry[] = ['record', 'write', 'paste']

interface Props {
  /** 오늘 잡혀 있는 미팅. 서버가 준다. 없으면 빈 배열 */
  todayMeetings?: TodayMeeting[]
}

export default function MeetingIntakeBox({ todayMeetings = [] }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<Entry | null>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * 한 번 누르면 곧장 작업대.
   *
   * 제목·시각·회사·딜을 **안 묻는다** — 회의는 이미 시작됐고 사용자는 녹음 버튼을 찾고 있다.
   * 비어 있는 것은 끝난 뒤에 AI 가 제안하거나 물어본다.
   */
  const begin = useCallback(async (entry: Entry) => {
    if (busy) return
    setBusy(entry)
    setError(null)
    try {
      const { id } = await startMeeting()
      router.push(`${meetingHref(id)}?wb=${ENTRY[entry].wb}`)
    } catch (e) {
      // 조용히 삼키지 않는다 — 눌렀는데 아무 일도 안 일어나는 화면이 가장 나쁘다
      setError(e instanceof Error ? e.message : '미팅을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.')
      setBusy(null)
    }
  }, [busy, router])

  return (
    <section className={`card ${styles.box}`} aria-labelledby="meeting-intake-title">
      <FormErrorBanner message={error} />

      {/* 섹션 제목은 명사구다 — 대화체를 쓰지 않는다(용어집 §06) */}
      <h2 id="meeting-intake-title" className={styles.title}>
        <Mic size={16} aria-hidden /> {MEETING_CAPTURE_LABEL}
      </h2>

      <div className={styles.actions}>
        {ENTRY_ORDER.map((k) => (
          <NbButton
            key={k}
            variant={ENTRY[k].primary ? 'primary' : 'ghost'}
            onClick={() => void begin(k)}
            disabled={busy !== null}
          >
            {ENTRY[k].icon}
            {busy === k ? progress('여는') : ENTRY[k].label}
          </NbButton>
        ))}
      </div>

      {/*
        오늘 잡혀 있는 미팅이 있으면 후보로 보여 준다.
        **새로 만들지 않는다** — 같은 회의가 두 벌이 되면 딜에 붙는 기록도 둘이 된다.
      */}
      {todayMeetings.length > 0 && (
        <ul className={styles.today}>
          {todayMeetings.map((m) => (
            <li key={m.id}>
              <a href={`${meetingHref(m.id)}?wb=transcript`} className={styles.todayItem}>
                <span className={styles.todayTime}>{formatKstTime(m.startedAt)}</span>
                <span className={styles.todayTitle}>
                  {m.title}
                  {m.companyName && <span className={styles.todayCompany}> · {m.companyName}</span>}
                </span>
                <ArrowRight size={14} aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
