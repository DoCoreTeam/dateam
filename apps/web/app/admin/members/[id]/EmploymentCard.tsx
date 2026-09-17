'use client'

// app/admin/members/[id]/EmploymentCard.tsx — 입사·퇴사 기록을 고치는 자리
//
// 입사일이 비어 있는 것이 기본이다. 지금 전원의 입사일을 모르므로(사용자 2026-09-17),
// 모르는 값을 오늘로 채워 두면 그 거짓이 영영 사실처럼 남는다. 빈칸을 빈칸으로 두고
// 아는 사람부터 채운다.
//
// 퇴사일을 여기서 넣거나 지우는 것은 목록의 퇴사 단추와 **같은 일**이다 — 로그인 차단과
// 해제가 함께 따라간다(서버가 처리). 화면이 두 갈래로 갈리면 어느 쪽이 진짜인지 모르게 된다.

import { useState, useTransition } from 'react'
import { Save, CalendarDays } from 'lucide-react'
import { updateEmployment } from '../../users/actions'
import InlineError from '@/components/ui/InlineError'
import NbButton from '@/components/ui/nb/NbButton'
import DateField from '@/components/ui/DateField'
import { validateEmployment, toDateOrNull } from '@/lib/members/employment'
import { EMPLOYMENT_FIELD, EMPLOYMENT_ACTION, EMPLOYMENT_STATUS, confirmResign } from '@/lib/terms'
import type { MemberEmployment } from '@/types/database'

interface Props {
  userId: string
  userName: string
  isSelf: boolean
  employment: MemberEmployment | null
}

export default function EmploymentCard({ userId, userName, isSelf, employment }: Props) {
  const [hiredOn, setHiredOn] = useState(employment?.hired_on ?? '')
  const [resignedOn, setResignedOn] = useState(employment?.resigned_on ?? '')
  const [reason, setReason] = useState(employment?.resign_reason ?? '')
  const [note, setNote] = useState(employment?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  const wasResigned = Boolean(employment?.resigned_on)
  const willResign = !wasResigned && Boolean(resignedOn.trim())

  function handleSave() {
    const invalid = validateEmployment({ hired_on: toDateOrNull(hiredOn), resigned_on: toDateOrNull(resignedOn) })
    if (invalid) { setError(invalid); return }
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const res = await updateEmployment(userId, { hiredOn, resignedOn, reason, note })
      if (res.ok) setSaved(true)
      else setError(res.error)
    })
  }

  return (
    <div className="card" style={{ padding: 'var(--space-5) var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        <CalendarDays size={16} color="var(--brand)" />
        <h2 className="tape-title" style={{ margin: 0 }}>재직 기록</h2>
        <span className="badge badge-slate">
          {wasResigned ? EMPLOYMENT_STATUS.resigned.label : EMPLOYMENT_STATUS.active.label}
        </span>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))',
        gap: 'var(--space-4)', marginBottom: 'var(--space-4)',
      }}>
        <div>
          <label className="label" htmlFor="emp-hired">{EMPLOYMENT_FIELD.hiredOn}</label>
          <DateField id="emp-hired" value={hiredOn} onValueChange={setHiredOn} disabled={pending} />
        </div>
        <div>
          <label className="label" htmlFor="emp-resigned">{EMPLOYMENT_FIELD.resignedOn}</label>
          <DateField id="emp-resigned" value={resignedOn} onValueChange={setResignedOn} disabled={pending || isSelf} />
        </div>
      </div>

      <div style={{ marginBottom: 'var(--space-4)' }}>
        <label className="label" htmlFor="emp-reason">{EMPLOYMENT_FIELD.resignReason}</label>
        <input id="emp-reason" className="input-field" value={reason}
          onChange={(e) => setReason(e.target.value)} disabled={pending} />
      </div>

      <div style={{ marginBottom: 'var(--space-4)' }}>
        <label className="label" htmlFor="emp-note">{EMPLOYMENT_FIELD.note}</label>
        <input id="emp-note" className="input-field" value={note}
          onChange={(e) => setNote(e.target.value)} disabled={pending} />
      </div>

      {/* 저장이 무슨 일을 하는지 누르기 전에 말한다 — 날짜 하나가 로그인을 막는다 */}
      {willResign && !isSelf && (
        <p role="status" style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--fs-xs)', color: 'var(--warning)' }}>
          {confirmResign(userName)}
        </p>
      )}
      {isSelf && (
        <p style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
          자기 자신은 퇴사 처리할 수 없어 퇴사일 칸이 잠겨 있습니다
        </p>
      )}

      <InlineError compact>{error}</InlineError>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <NbButton type="button" onClick={handleSave} disabled={pending}>
          <Save size={14} />
          {pending ? '저장 중' : EMPLOYMENT_ACTION.save}
        </NbButton>
        {saved && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--success)', fontWeight: 600 }}>저장됨</span>}
      </div>
    </div>
  )
}
