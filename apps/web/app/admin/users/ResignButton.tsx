'use client'

// app/admin/users/ResignButton.tsx — 퇴사 처리와 되돌리기
//
// 삭제 단추와 나란히 놓이므로 **무엇이 다른지 누르기 전에 읽혀야 한다.** 그래서 확인 문구가
// 「기록은 그대로 남습니다」를 말한다 — 그 한 줄이 두 단추를 가르는 전부다.
// 확인은 브라우저 confirm 이 아니라 그 자리에서 편다(DeleteTierButton 과 같은 방식).
// confirm 은 창을 띄우는 동안 화면 전체를 멈추고, 누구를 내보내는지 목록에서 눈을 떼게 만든다.

import { useState, useTransition } from 'react'
import { LogOut, RotateCcw } from 'lucide-react'
import { resignMember, undoResignMember } from './actions'
import InlineError from '@/components/ui/InlineError'
import NbButton from '@/components/ui/nb/NbButton'
import { EMPLOYMENT_ACTION, confirmResign, confirmUndoResign } from '@/lib/terms'

interface Props {
  userId: string
  userName: string
  isSelf: boolean
  isResigned: boolean
}

export default function ResignButton({ userId, userName, isSelf, isResigned }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // 자기 자신을 퇴사시키면 그 자리에서 로그인이 막혀 되돌릴 사람이 사라진다
  if (isSelf) return null

  const label = isResigned ? EMPLOYMENT_ACTION.undoResign : EMPLOYMENT_ACTION.resign
  const question = isResigned ? confirmUndoResign(userName) : confirmResign(userName)

  function run() {
    setError(null)
    startTransition(async () => {
      const res = isResigned ? await undoResignMember(userId) : await resignMember(userId)
      if (res.ok) setConfirming(false)
      else { setError(res.error); setConfirming(false) }
    })
  }

  if (confirming) {
    return (
      <span style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', maxWidth: '16rem' }}>
        <span role="alert" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{question}</span>
        <InlineError compact>{error}</InlineError>
        <span style={{ display: 'flex', gap: 'var(--space-1)' }}>
          <NbButton type="button" onClick={run} disabled={pending}>{pending ? '처리 중' : '확인'}</NbButton>
          <NbButton type="button" variant="secondary" onClick={() => { setConfirming(false); setError(null) }} disabled={pending}>
            취소
          </NbButton>
        </span>
      </span>
    )
  }

  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <NbButton type="button" variant="secondary" onClick={() => setConfirming(true)} title={`${userName} ${label}`}>
        {isResigned ? <RotateCcw size={13} /> : <LogOut size={13} />} {label}
      </NbButton>
      <InlineError compact>{error}</InlineError>
    </span>
  )
}
