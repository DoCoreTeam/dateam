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

import { Mic, PenLine, ClipboardPaste, ArrowRight } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { meetingHref } from '@/lib/crm/ui/start-meeting'
import { useStartMeeting } from '@/lib/meeting/use-start-meeting'
import { startBlockedMessage } from '@/lib/meeting/start-guard'
import type { StartEntry } from '@/lib/meeting/start-flow'
import { MEETING_CAPTURE_LABEL, RECORD_START_LABEL, progress } from '@/lib/terms'
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
 * 셋 다 목적지는 **같은 작업대**다, 회의 중 화면 전환을 0회로 두기 위해서다.
 * 처음 보이는 탭과 녹음을 켤지는 시작 한 길(`lib/meeting/start-flow.ts`)이 정한다.
 */
type Entry = StartEntry

const ENTRY: Record<Entry, { label: string; icon: React.ReactNode; primary?: boolean }> = {
  record: { label: RECORD_START_LABEL, icon: <Mic size={15} />, primary: true },
  write: { label: '직접 작성', icon: <PenLine size={15} /> },
  paste: { label: '붙여넣기', icon: <ClipboardPaste size={15} /> },
}

/** 지난 날짜에는 녹음이 아니라 작성으로 연다 — 이미 끝난 회의를 녹음할 수는 없다 */
const ENTRY_ORDER: Entry[] = ['record', 'write', 'paste']

interface Props {
  /** 오늘 잡혀 있는 미팅. 서버가 준다. 없으면 빈 배열 */
  todayMeetings?: TodayMeeting[]
}

export default function MeetingIntakeBox({ todayMeetings = [] }: Props) {
  /**
   * 한 번 누르면 곧장 작업대.
   *
   * 제목·시각·회사·딜을 **안 묻는다**, 회의는 이미 시작됐고 사용자는 녹음 버튼을 찾고 있다.
   * 녹음 중 막기, 연결이 없을 때 기기 녹음, 실패 안내는 훅이 한 자리에서 한다.
   */
  const { start, busy, block, message } = useStartMeeting()
  const error = message?.tone === 'error' ? message.text : null
  /** 화면이 안 바뀌는 경우가 생겼다, 눌렀는데 아무 말도 없으면 안 된 줄 안다 */
  const notice = message?.tone === 'note' ? message.text : null

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
            onClick={() => void start({ entry: k })}
            disabled={busy !== null || block !== null}
          >
            {ENTRY[k].icon}
            {busy === k ? progress('여는') : ENTRY[k].label}
          </NbButton>
        ))}
      </div>

      {/* 화면이 안 바뀌었을 때 무슨 일이 일어났는지 — 이 줄이 없으면 안 된 줄 안다 */}
      {notice && <p className="field-note">{notice}</p>}
      {block && !notice && <p className="field-note" role="status">{startBlockedMessage(block)}</p>}

      {/*
        오늘 잡혀 있는 미팅이 있으면 후보로 보여 준다.
        **새로 만들지 않는다** — 같은 회의가 두 벌이 되면 딜에 붙는 기록도 둘이 된다.
      */}
      {todayMeetings.length > 0 && (
        <ul className={styles.today}>
          {todayMeetings.map((m) => (
            <li key={m.id}>
              {/**
                * 탭을 지정하지 않는다 — 작업대가 «내용이 있는 곳»을 열게 둔다.
                * 예전엔 여기서 `?wb=transcript` 를 조건 없이 붙여, 193자를 써 둔 회의를 눌러도
                * 빈 전사 탭이 열렸다(사용자 지적 2026-08-31).
                */}
              <a href={meetingHref(m.id)} className={styles.todayItem}>
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
