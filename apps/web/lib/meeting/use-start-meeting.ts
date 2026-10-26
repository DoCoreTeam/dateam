'use client'

/**
 * 회의 시작 입구가 함께 쓰는 훅
 *
 * 라우터, 녹음 제공자, 녹음 중 막기, 시작 한 길(`runStartFlow`)을 한 자리에서 엮는다.
 * 입구마다 이 조립을 다시 하면 막기와 오프라인 녹음이 입구마다 갈린다.
 */

import { useCallback, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useRecordingSession } from '@/lib/meeting/recording-context'
import { activeRecordingBlock, startBlockedMessage, startUnlessRecording, type StartBlock } from '@/lib/meeting/start-guard'
import { runStartFlow, START_MESSAGES, type StartEntry, type StartTarget } from '@/lib/meeting/start-flow'
import { startMeetingNote } from '@/app/(member)/meeting-notes/actions'

export interface StartMeetingRequest {
  entry: StartEntry
  target?: StartTarget
  dealId?: string | null
  companyId?: string | null
  dateKey?: string | null
}

export interface StartMeetingMessage {
  tone: 'error' | 'note'
  text: string
}

export interface UseStartMeeting {
  start: (req: StartMeetingRequest) => Promise<void>
  /** 누른 입구, 화면을 옮기는 중이면 풀지 않는다 (두 번 눌러 회의가 둘 생기지 않게) */
  busy: StartEntry | null
  /** 녹음이 돌고 있어 시작을 막는 중이면 그 녹음 */
  block: StartBlock | null
  message: StartMeetingMessage | null
}

const DEFAULT_HREF = '/home'

export function useStartMeeting(): UseStartMeeting {
  const router = useRouter()
  const pathname = usePathname()
  const rec = useRecordingSession()
  const [busy, setBusy] = useState<StartEntry | null>(null)
  const [message, setMessage] = useState<StartMeetingMessage | null>(null)
  const block = activeRecordingBlock(rec)

  const start = useCallback(async (req: StartMeetingRequest) => {
    if (busy) return
    setBusy(req.entry)
    setMessage(null)
    try {
      const guarded = await startUnlessRecording(rec, () => runStartFlow(req, { startNote: startMeetingNote }))
      if (guarded.blocked) {
        setMessage({ tone: 'note', text: startBlockedMessage(guarded.blocked) })
        setBusy(null)
        return
      }
      const out = guarded.result
      if (out.kind === 'navigate') {
        router.push(out.href)
        return
      }
      // 서버에 못 닿았다. 없는 주소로 옮기지 않고 그 자리에서 녹음을 켠다
      await rec.start({ noteId: out.localId, title: out.title, href: pathname || DEFAULT_HREF })
      setMessage({ tone: 'note', text: START_MESSAGES.offlineRecording })
      setBusy(null)
    } catch (e) {
      // 조용히 삼키지 않는다, 눌렀는데 아무 일도 안 일어나는 화면이 가장 나쁘다
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : START_MESSAGES.crmFailed })
      setBusy(null)
    }
  }, [busy, rec, router, pathname])

  return { start, busy, block, message }
}
