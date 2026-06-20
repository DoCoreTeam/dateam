'use client'

// 회의노트 → 파생 업무 컨텍스트 뷰 (/daily?meeting=<id> 진입 시)
//  - 캘린더 회의 일정 클릭 → 이 노트에서 생성된 일일업무(meeting_note_id 매칭)를 모아 보여준다.
//  - 날짜 타임라인 모드와 독립된 contained 섹션(기존 day/week/memo 로직 무간섭 — 회귀 0).
//  - 읽기 전용 목록: 출처 추적·순회용. 편집/삭제는 일반 일간 뷰에서.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ClipboardList, ArrowRight } from 'lucide-react'
import type { DailyLog, DailyLogEntryType } from '@/types/database'
import { getMeetingDerivedLogs, getMeetingNote } from '../meeting-notes/actions'
import { STATUS_LIST } from '@/lib/tokens/status-colors'

const ENTRY_MAP = Object.fromEntries(
  (STATUS_LIST as { value: DailyLogEntryType; label: string; color: string; bg: string; border: string }[]).map((t) => [t.value, t])
) as Record<DailyLogEntryType, { value: DailyLogEntryType; label: string; color: string; bg: string; border: string }>

function formatLogged(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function MeetingContextView({ meetingId }: { meetingId: string }) {
  const [logs, setLogs] = useState<DailyLog[]>([])
  const [title, setTitle] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    Promise.all([getMeetingDerivedLogs(meetingId), getMeetingNote(meetingId)])
      .then(([derived, note]) => {
        if (!alive) return
        setLogs(derived)
        setTitle(note?.title ?? '')
      })
      .catch(() => { if (alive) setError('회의 파생 업무를 불러오지 못했습니다.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [meetingId])

  const noteHref = `/meeting-notes/${meetingId}`
  const heading = title ? `'${title}'` : '회의'

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: '1rem' }} aria-label="회의 파생 업무">
      {/* 배너 — 회의 컨텍스트 + 회의노트 보기 링크 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
        gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)',
        background: 'var(--brand-soft)', border: 'var(--hairline) solid var(--brand-soft-2)',
        borderRadius: 'var(--radius)',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--fs-base)', fontWeight: 600, color: 'var(--text)' }}>
          <ClipboardList size={16} color="var(--brand)" />
          {loading
            ? '회의 파생 업무를 불러오는 중…'
            : logs.length > 0
              ? `${heading} 회의에서 생성된 업무 ${logs.length}건`
              : `${heading} 회의에서 아직 생성된 업무가 없습니다`}
        </span>
        <Link href={noteHref} className="btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', textDecoration: 'none', padding: 'var(--space-2) var(--space-4)', minHeight: 36, whiteSpace: 'nowrap' }}>
          회의노트 보기 <ArrowRight size={15} />
        </Link>
      </div>

      {error && <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>{error}</p>}

      {/* 파생 업무 목록(읽기 전용) */}
      {!loading && logs.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {logs.map((log) => {
            const type = ENTRY_MAP[log.entry_type] ?? ENTRY_MAP['note']
            return (
              <li
                key={log.id}
                style={{
                  background: 'var(--color-surface)', border: 'var(--border-w-2) solid var(--border-color)',
                  borderLeft: `var(--border-w) solid ${type.color}`,
                  borderRadius: '0 0.5rem 0.5rem 0', padding: 'var(--space-3) var(--space-4)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '0.375rem', flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 'var(--fs-2xs)', fontWeight: 700, color: type.color,
                    background: type.bg, border: `var(--hairline) solid ${type.border}`,
                    padding: '0.1rem 0.4rem', borderRadius: 'var(--radius)',
                  }}>
                    {type.label}
                  </span>
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{formatLogged(log.logged_at)}</span>
                </div>
                <p style={{ margin: 0, fontSize: 'var(--fs-md)', color: 'var(--text)', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {log.content}
                </p>
              </li>
            )
          })}
        </ul>
      )}

      {/* 빈 상태 — 배너가 안내, 추가 행동 유도 */}
      {!loading && logs.length === 0 && !error && (
        <div style={{
          textAlign: 'center', color: 'var(--text-faint)', padding: 'var(--space-8) var(--space-0)',
          border: 'var(--hairline) dashed var(--color-border)', borderRadius: 'var(--radius)',
          fontSize: 'var(--fs-base)',
        }}>
          이 회의에서 아직 생성된 업무가 없습니다. 회의노트에서 AI 분석으로 업무를 추출해 보세요.
        </div>
      )}
    </section>
  )
}
