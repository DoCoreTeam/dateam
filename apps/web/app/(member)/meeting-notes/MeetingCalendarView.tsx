// 캘린더 보기 — 월 달력 그리드에 회의를 날짜 칸에 배치. ?ym=YYYY-MM 으로 월 이동.
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { MeetingListItemView } from './list-types'

interface Props {
  items: MeetingListItemView[]
  ym: string // 'YYYY-MM'
  q: string
  sort: string
  filter: string
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function parseYm(ym: string): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(ym)
  if (!m) {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  }
  return { year: Number(m[1]), month: Number(m[2]) - 1 }
}

function ymStr(year: number, month: number): string {
  const y = month < 0 ? year - 1 : month > 11 ? year + 1 : year
  const mm = ((month % 12) + 12) % 12
  return `${y}-${String(mm + 1).padStart(2, '0')}`
}

function dayKey(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function MeetingCalendarView({ items, ym, q, sort, filter }: Props) {
  const { year, month } = parseYm(ym)

  function navHref(targetYm: string): string {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (sort !== 'recent') params.set('sort', sort)
    if (filter !== 'all') params.set('filter', filter)
    params.set('view', 'calendar')
    params.set('ym', targetYm)
    return `/meeting-notes?${params.toString()}`
  }

  // 날짜 → 회의 목록
  const byDay = new Map<string, MeetingListItemView[]>()
  for (const m of items) {
    const k = dayKey(m.meeting_at)
    if (!k) continue
    const arr = byDay.get(k)
    if (arr) arr.push(m); else byDay.set(k, [m])
  }

  const first = new Date(year, month, 1)
  const leading = first.getDay() // 0=일
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < leading; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const pad = (n: number) => String(n).padStart(2, '0')

  return (
    <div style={{ padding: 'var(--space-5) var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* 월 이동 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-4)' }}>
        <Link href={navHref(ymStr(year, month - 1))} className="btn-ghost" aria-label="이전 달"
          style={{ display: 'inline-flex', alignItems: 'center', padding: 'var(--space-2)', minHeight: 40, textDecoration: 'none' }}>
          <ChevronLeft size={18} />
        </Link>
        <strong style={{ fontSize: 'var(--fs-lg)', color: 'var(--text)', minWidth: 140, textAlign: 'center' }}>{year}년 {month + 1}월</strong>
        <Link href={navHref(ymStr(year, month + 1))} className="btn-ghost" aria-label="다음 달"
          style={{ display: 'inline-flex', alignItems: 'center', padding: 'var(--space-2)', minHeight: 40, textDecoration: 'none' }}>
          <ChevronRight size={18} />
        </Link>
      </div>

      {/* 요일 헤더 — 캘린더는 본질적으로 7열(콘텐츠 반응형 그리드 아님) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'var(--space-1)' }}>
        {WEEKDAYS.map((w, i) => (
          <div key={w} style={{ textAlign: 'center', fontSize: 'var(--fs-xs)', fontWeight: 700, color: i === 0 ? 'var(--danger)' : i === 6 ? 'var(--info)' : 'var(--text-muted)', padding: 'var(--space-1) 0' }}>{w}</div>
        ))}
      </div>

      {/* 날짜 칸 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'var(--space-1)' }}>
        {cells.map((d, idx) => {
          if (d === null) return <div key={`e-${idx}`} style={{ minHeight: 88 }} />
          const key = `${year}-${pad(month + 1)}-${pad(d)}`
          const dayItems = byDay.get(key) ?? []
          const weekday = idx % 7
          return (
            <div key={key} style={{ minHeight: 88, padding: 'var(--space-1) var(--space-2)', background: 'var(--surface-bg)', borderRadius: 'var(--radius)', border: 'var(--hairline) solid var(--border-light)', display: 'flex', flexDirection: 'column', gap: '0.2rem', overflow: 'hidden' }}>
              <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: weekday === 0 ? 'var(--danger)' : weekday === 6 ? 'var(--info)' : 'var(--text-muted)' }}>{d}</span>
              {dayItems.slice(0, 3).map((m) => (
                <Link key={m.id} href={`/meeting-notes/${m.id}`} title={m.title}
                  style={{ display: 'block', fontSize: 'var(--fs-2xs)', color: 'var(--text)', textDecoration: 'none', background: 'var(--surface-card)', borderRadius: 'var(--radius)', padding: '0.1rem 0.3rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderLeft: 'var(--border-w-2) solid var(--brand)' }}>
                  {m.title || '(제목 없음)'}
                </Link>
              ))}
              {dayItems.length > 3 && (
                <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>+{dayItems.length - 3}건</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
