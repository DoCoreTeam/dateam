import { Mail, Building2, Shield, CalendarDays, KeyRound } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Profile } from '@/types/database'

/**
 * 계정에 대해 이미 아는 사실 — 여기서 고치지 않는다.
 * 고치는 자리는 목록의 「수정」과 아래 재직 기록 둘뿐이라, 같은 값을 세 군데서 고치게 되면
 * 어디가 진실인지 알 수 없어진다.
 */
export default function MemberFacts({
  profile, email, department,
}: {
  profile: Profile
  email: string
  department: string | null
}) {
  const facts: { icon: ReactNode; label: string; value: ReactNode }[] = [
    { icon: <Mail size={14} />, label: '이메일', value: email || '—' },
    { icon: <Shield size={14} />, label: '역할', value: profile.role },
    { icon: <Building2 size={14} />, label: '소속', value: department ?? '조직도에 없음' },
    { icon: <CalendarDays size={14} />, label: '가입일', value: new Date(profile.created_at).toLocaleDateString('ko-KR') },
    { icon: <KeyRound size={14} />, label: '초기 비밀번호 변경', value: profile.must_change_password ? '대기중' : '완료' },
  ]

  return (
    <div className="card" style={{ padding: 'var(--space-5) var(--space-6)', marginBottom: '1.5rem' }}>
      <h2 className="tape-title" style={{ margin: '0 0 var(--space-4)' }}>계정</h2>
      <dl style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))',
        gap: 'var(--space-4)', margin: 0,
      }}>
        <div>
          <dt style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>직급 · 직책</dt>
          <dd style={{ margin: 0, fontSize: 'var(--fs-base)' }}>
            {[profile.rank, profile.position].filter(Boolean).join(' · ') || '—'}
          </dd>
        </div>
        {facts.map((f) => (
          <div key={f.label}>
            <dt style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>
              {f.icon}{f.label}
            </dt>
            <dd style={{ margin: 0, fontSize: 'var(--fs-base)' }}>{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
