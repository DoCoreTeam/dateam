'use client'

// components/meeting/MeetingStartButton.tsx, 어디서든 회의를 녹음부터 시작하는 단추
//
// 사용자 지시(2026-10-22): 회의노트에도 녹음, 홈에서 바로 시작,
// CRM 권한이 있으면 CRM 미팅으로 간다. 어디로 갈지는 서버가 `hasCrmMeetingAccess` 로 정해 넘긴다.
//
// 두 길 모두 **기록을 먼저 만들고 그 작업대의 녹음 자리로 간다.** 제목·시각은 묻지 않는다.
//   crm   → `beginRecording` (CRM 첫 화면 `MeetingIntakeBox` 와 같은 길, 연결이 없으면 기기에 녹음)
//   notes → `startMeetingNote` (회의노트 기록, 연결이 없으면 시작하지 않았다고 말함)

import { useCallback, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Mic } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import { meetingHref } from '@/lib/crm/ui/start-meeting'
import { beginRecording } from '@/lib/meeting/begin-recording'
import { useRecordingSession } from '@/lib/meeting/recording-context'
import { startMeetingNote } from '@/app/(member)/meeting-notes/actions'
import { RECORD_START_LABEL, progress } from '@/lib/terms'
import type { MeetingEntry } from '@/lib/crm/auth/meeting-entry'

/** 녹음 탭을 열고 들어간다, 작업대의 기존 규약 */
const RECORD_TAB = '?wb=transcript'

const NOTES_FAILED = '회의노트를 만들지 못해 녹음을 시작하지 않았어요. 연결을 확인하고 다시 눌러 주세요.'
const CRM_FAILED = '미팅을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.'
const OFFLINE_RECORDING = '연결이 없어 이 기기에 녹음하고 있어요. 연결되면 자동으로 올라갑니다.'

interface Props {
  target: MeetingEntry
  variant?: 'primary' | 'ghost'
}

export default function MeetingStartButton({ target, variant = 'primary' }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const rec = useRecordingSession()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'error' | 'note'; text: string } | null>(null)

  const startNote = useCallback(async () => {
    const out = await startMeetingNote().catch(() => null)
    if (!out || !out.ok) {
      setMessage({ tone: 'error', text: out && !out.ok ? out.error : NOTES_FAILED })
      return false
    }
    router.push(`/meeting-notes/${out.id}${RECORD_TAB}`)
    return true
  }, [router])

  const startCrm = useCallback(async () => {
    const out = await beginRecording()
    if (out.kind === 'server') {
      router.push(`${meetingHref(out.id)}${RECORD_TAB}`)
      return true
    }
    // 서버에 못 닿았다. 없는 주소로 옮기지 않고 그 자리에서 녹음을 켠다(MeetingIntakeBox 와 같다)
    await rec.start({ noteId: out.localId, title: out.title, href: pathname || '/home' })
    setMessage({ tone: 'note', text: OFFLINE_RECORDING })
    return false
  }, [router, rec, pathname])

  const begin = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      const moved = target === 'crm' ? await startCrm() : await startNote()
      // 화면을 옮겼으면 단추는 잠근 채로 둔다, 두 번 눌러 기록이 둘 생기지 않게
      if (!moved) setBusy(false)
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : CRM_FAILED })
      setBusy(false)
    }
  }, [busy, target, startCrm, startNote])

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--space-1)' }}>
      <NbButton variant={variant} onClick={() => void begin()} disabled={busy} style={{ minHeight: 44, whiteSpace: 'nowrap' }}>
        <Mic size={16} aria-hidden />
        {busy ? progress('여는') : RECORD_START_LABEL}
      </NbButton>
      {message && (
        <span
          role={message.tone === 'error' ? 'alert' : 'status'}
          className="field-note"
          style={{ color: message.tone === 'error' ? 'var(--danger)' : undefined, maxWidth: '22rem', textAlign: 'right' }}
        >
          {message.text}
        </span>
      )}
    </span>
  )
}
