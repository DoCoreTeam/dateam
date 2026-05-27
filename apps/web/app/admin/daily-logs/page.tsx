import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { DailyLog, Profile } from '@/types/database'

const ENTRY_TYPES = {
  done:    { label: '완료',   icon: '✅', color: '#16a34a', bg: '#f0fdf4' },
  doing:   { label: '진행중', icon: '🔄', color: '#2563eb', bg: '#eff6ff' },
  planned: { label: '예정',   icon: '📋', color: '#7c3aed', bg: '#f5f3ff' },
  blocker: { label: '블로커', icon: '🚫', color: '#dc2626', bg: '#fef2f2' },
  note:    { label: '메모',   icon: '📌', color: '#d97706', bg: '#fffbeb' },
} as const

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  const days = ['일', '월', '화', '수', '목', '금', '토']
  return `${d.getMonth() + 1}/${d.getDate()} (${days[d.getDay()]})`
}

function formatTime(isoStr: string) {
  const d = new Date(isoStr)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

interface PageProps {
  searchParams: Promise<{ date?: string; user?: string; type?: string }>
}

export default async function AdminDailyLogsPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const { data: profile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single() as unknown as { data: Pick<Profile, 'role'> | null; error: unknown }

  if (!profile || profile.role !== 'admin') redirect('/dashboard')

  const params = await searchParams
  const today = toDateStr(new Date())
  const selectedDate = params.date ?? today
  const selectedUser = params.user ?? ''
  const selectedType = params.type ?? ''

  // 멤버 목록 (관리자 포함 전체)
  const { data: members } = await adminClient
    .from('profiles')
    .select('id, name')
    .is('deleted_at', null)
    .order('name') as unknown as { data: Pick<Profile, 'id' | 'name'>[] | null; error: unknown }

  // 로그 쿼리
  const ADMIN_LOG_LIMIT = 2000
  let query = (supabase.from('daily_logs') as any)
    .select('*, profiles!inner(name)')
    .eq('log_date', selectedDate)
    .order('user_id')
    .order('logged_at', { ascending: true })
    .limit(ADMIN_LOG_LIMIT)

  if (selectedUser) query = query.eq('user_id', selectedUser)
  if (selectedType) query = query.eq('entry_type', selectedType)

  const { data: logs } = await query as { data: (DailyLog & { profiles: { name: string } })[] | null }

  // 멤버별 그룹핑
  const grouped: Record<string, { name: string; logs: (DailyLog & { profiles: { name: string } })[] }> = {}
  for (const log of (logs ?? []) as (DailyLog & { profiles: { name: string } })[]) {
    if (!grouped[log.user_id]) {
      grouped[log.user_id] = { name: log.profiles.name, logs: [] }
    }
    grouped[log.user_id].logs.push(log)
  }

  const totalBlockers = (logs ?? []).filter((l) => l.entry_type === 'blocker').length
  const totalLogs = logs?.length ?? 0
  const activeMembers = Object.keys(grouped).length

  return (
    <div className="page-inner">
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
          일일업무 모니터링
        </h1>
        <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '0.25rem' }}>
          팀원들의 일일 업무 기록을 확인합니다.
        </p>
      </div>

      {/* 요약 카드 */}
      <div className="responsive-grid-cols-3" style={{ marginBottom: '1.5rem', gap: '0.75rem' }}>
        {[
          { label: '참여 인원', value: `${activeMembers}명`, sub: `전체 ${members?.length ?? 0}명 중`, color: '#3b82f6' },
          { label: '총 로그', value: `${totalLogs}건`, sub: formatDate(selectedDate), color: '#16a34a' },
          { label: '블로커', value: `${totalBlockers}건`, sub: totalBlockers > 0 ? '주의 필요' : '문제 없음', color: totalBlockers > 0 ? '#dc2626' : '#16a34a' },
        ].map((c) => (
          <div key={c.label} style={{
            background: '#fff', border: '1px solid #e2e8f0', borderRadius: '0.75rem',
            padding: '1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.25rem' }}>{c.label}</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: c.color }}>{c.value}</div>
            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* 필터 */}
      <form method="GET" style={{
        display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem',
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: '0.75rem',
        padding: '0.875rem',
      }}>
        <input
          type="date"
          name="date"
          defaultValue={selectedDate}
          max={today}
          style={filterInputStyle}
        />
        <select name="user" defaultValue={selectedUser} style={filterInputStyle}>
          <option value="">전체 멤버</option>
          {(members ?? []).map((m: Pick<Profile, 'id' | 'name'>) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <select name="type" defaultValue={selectedType} style={filterInputStyle}>
          <option value="">전체 타입</option>
          {Object.entries(ENTRY_TYPES).map(([k, v]) => (
            <option key={k} value={k}>{v.icon} {v.label}</option>
          ))}
        </select>
        <button type="submit" style={{
          padding: '0.5rem 1rem', background: '#3b82f6', color: '#fff',
          border: 'none', borderRadius: '0.5rem', fontWeight: 600,
          fontSize: '0.875rem', cursor: 'pointer',
        }}>
          조회
        </button>
      </form>

      {/* 멤버별 로그 */}
      {Object.keys(grouped).length === 0 ? (
        <div style={{
          textAlign: 'center', color: '#94a3b8', padding: '3rem',
          border: '1px dashed #e2e8f0', borderRadius: '0.75rem',
        }}>
          {formatDate(selectedDate)}에 작성된 로그가 없습니다.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {Object.entries(grouped).map(([userId, group]) => (
            <div key={userId} style={{
              background: '#fff', border: '1px solid #e2e8f0', borderRadius: '0.75rem',
              overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}>
              {/* 멤버 헤더 */}
              <div style={{
                padding: '0.875rem 1rem', background: '#f8fafc',
                borderBottom: '1px solid #e2e8f0', display: 'flex',
                alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                  <div style={{
                    width: '2rem', height: '2rem', borderRadius: '50%',
                    background: '#3b82f6', color: '#fff', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: '0.875rem', fontWeight: 700,
                  }}>
                    {group.name[0] ?? '?'}
                  </div>
                  <span style={{ fontWeight: 600, color: '#0f172a' }}>{group.name}</span>
                </div>
                <div style={{ display: 'flex', gap: '0.375rem' }}>
                  {group.logs.filter((l) => l.entry_type === 'blocker').length > 0 && (
                    <span style={{
                      fontSize: '0.75rem', fontWeight: 600, color: '#dc2626',
                      background: '#fef2f2', padding: '0.125rem 0.5rem', borderRadius: '1rem',
                    }}>
                      🚫 블로커 {group.logs.filter((l) => l.entry_type === 'blocker').length}건
                    </span>
                  )}
                  <span style={{
                    fontSize: '0.75rem', color: '#64748b',
                    background: '#f1f5f9', padding: '0.125rem 0.5rem', borderRadius: '1rem',
                  }}>
                    {group.logs.length}건
                  </span>
                </div>
              </div>

              {/* 로그 목록 */}
              <div style={{ padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {group.logs.map((log) => {
                  const type = ENTRY_TYPES[log.entry_type as keyof typeof ENTRY_TYPES] ?? ENTRY_TYPES.note
                  return (
                    <div key={log.id} style={{
                      display: 'flex', alignItems: 'flex-start', gap: '0.625rem',
                      padding: '0.625rem 0.75rem',
                      borderLeft: `3px solid ${type.color}`,
                      background: log.entry_type === 'blocker' ? '#fef2f2' : '#fafafa',
                      borderRadius: '0 0.375rem 0.375rem 0',
                    }}>
                      <span style={{ fontSize: '1rem', flexShrink: 0, marginTop: '0.1rem' }}>{type.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.2rem' }}>
                          <span style={{
                            fontSize: '0.6875rem', fontWeight: 600, color: type.color,
                            background: type.bg, padding: '0.1rem 0.35rem', borderRadius: '0.25rem',
                          }}>
                            {type.label}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                            {formatTime(log.logged_at)}
                          </span>
                        </div>
                        <p style={{
                          margin: 0, fontSize: '0.9rem', color: '#1e293b',
                          lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        }}>
                          {log.content}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const filterInputStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem',
  fontSize: '0.875rem', color: '#0f172a', background: '#f8fafc', outline: 'none',
}
