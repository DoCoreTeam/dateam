'use client'

// components/meeting/MeetingStartButton.tsx, 어디서든 회의를 녹음부터 시작하는 단추
//
// 사용자 지시(2026-10-22): 회의노트에도 녹음, 홈에서 바로 시작,
// CRM 권한이 있으면 CRM 미팅으로 간다. 어디로 갈지는 서버가 `hasCrmMeetingAccess` 로 정해 넘긴다.
//
// 두 길 모두 회의 시작 한 길(`useStartMeeting`)을 지난다. 기록을 만들고 작업대를 메모 편집기로 열고 녹음을 켠다.
// 제목과 시각은 묻지 않는다. 연결이 없으면 그 자리에서 기기에 녹음하고 그렇다고 말한다.

import { Mic } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import { useStartMeeting } from '@/lib/meeting/use-start-meeting'
import { startBlockedMessage } from '@/lib/meeting/start-guard'
import { RECORD_START_LABEL, progress } from '@/lib/terms'
import type { MeetingEntry } from '@/lib/crm/auth/meeting-entry'

interface Props {
  target: MeetingEntry
  variant?: 'primary' | 'ghost'
}

export default function MeetingStartButton({ target, variant = 'primary' }: Props) {
  /** 녹음이 하나라도 돌면 새 회의를 안 만든다. 다시 눌러 회의가 두 벌 생긴 실측(2026-10-26) */
  const { start, busy, block, message } = useStartMeeting()

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--space-1)' }}>
      <NbButton variant={variant} onClick={() => void start({ entry: 'record', target })} disabled={busy !== null || block !== null} style={{ minHeight: 44, whiteSpace: 'nowrap' }}>
        <Mic size={16} aria-hidden />
        {busy ? progress('여는') : RECORD_START_LABEL}
      </NbButton>
      {block && !message && (
        <span role="status" className="field-note" style={{ maxWidth: '22rem', textAlign: 'right' }}>
          {startBlockedMessage(block)}
        </span>
      )}
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
