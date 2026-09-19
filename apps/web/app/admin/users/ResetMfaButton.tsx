'use client'

import { useState } from 'react'
import { ShieldOff } from 'lucide-react'
import InlineError from '@/components/ui/InlineError'
import NbButton from '@/components/ui/nb/NbButton'
import { withSubmitGuard } from '@/lib/forms/submit-guard'
import { resetUserMfa } from './actions'

interface Props {
  userId: string
  userName: string
}

/**
 * 2단계 인증 해제 — 휴대폰을 잃은 사람을 되돌리는 단 하나의 길.
 *
 * 비밀번호 초기화로는 안 풀린다(2단계는 다른 벽이다). 이 버튼이 없으면
 * 장치를 잃은 계정은 영영 못 들어온다.
 */
export default function ResetMfaButton({ userId, userName }: Props) {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleReset = async () => {
    if (!confirm(`${userName}님의 2단계 인증을 해제하시겠습니까?\n해제하면 비밀번호만으로 로그인할 수 있게 되므로, 본인 확인을 먼저 하세요.`)) return
    setLoading(true)
    await withSubmitGuard(async () => {
      setDone(null)
      setError(null)
      const result = await resetUserMfa(userId)
      setLoading(false)
      if (result.ok) {
        setDone(result.removed > 0 ? `장치 ${result.removed}개 해제` : '등록된 장치 없음')
      } else {
        setError(result.error)
      }
    }, { onError: setError, onDone: () => setLoading(false) })
  }

  return (
    <div>
      <NbButton variant="ghost" onClick={handleReset} disabled={loading}>
        <ShieldOff size={13} /> {loading ? '해제 중…' : '2단계 해제'}
      </NbButton>
      {done && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>{done}</div>}
      {error && <InlineError compact>{error}</InlineError>}
    </div>
  )
}
