import type React from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWeekStart, toDateString } from '@/lib/utils'
import { subWeeks } from 'date-fns'
import { upsertWeeklyReport } from './actions'
import ReportAccordion from './ReportAccordion'
import { CATEGORIES } from './constants'
import { FileText, Save } from 'lucide-react'
import type { WeeklyReport } from '@/types/database'

const CELL_BORDER = '1px solid #e2e8f0'

function thStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    padding: '0.625rem 0.75rem',
    textAlign: 'left',
    fontWeight: 600,
    color: '#475569',
    border: CELL_BORDER,
    whiteSpace: 'nowrap',
    ...extra,
  }
}

function tdStyle(): React.CSSProperties {
  return { padding: '0.375rem', border: CELL_BORDER, verticalAlign: 'top' }
}

function tdLabelStyle(): React.CSSProperties {
  return {
    padding: '0.625rem 0.75rem',
    border: CELL_BORDER,
    fontWeight: 600,
    color: '#334155',
    whiteSpace: 'nowrap',
    verticalAlign: 'middle',
  }
}

const taStyle: React.CSSProperties = {
  width: '100%',
  border: 'none',
  outline: 'none',
  resize: 'vertical',
  fontSize: '0.8125rem',
  lineHeight: 1.55,
  color: '#0f172a',
  background: 'transparent',
  padding: '0.25rem 0.375rem',
  minHeight: '88px',
  fontFamily: 'inherit',
}

interface PageProps {
  searchParams: Promise<{ error?: string; success?: string }>
}

export default async function WeeklyReportPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { error, success } = await searchParams

  // 최근 8주 선택지
  const weekOptions = Array.from({ length: 8 }, (_, i) => {
    const d = getWeekStart(subWeeks(new Date(), i))
    return toDateString(d)
  })

  const thisWeek = weekOptions[0]

  // 내 주간보고 히스토리
  const { data: reports } = await supabase
    .from('weekly_reports')
    .select('*')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .order('week_start', { ascending: false })
    .order('category', { ascending: true }) as unknown as { data: WeeklyReport[] | null; error: unknown }

  // 이번 주 기존 데이터 (폼 프리필용)
  const thisWeekData = (reports ?? []).filter((r) => r.week_start === thisWeek)
  const prefill = Object.fromEntries(
    CATEGORIES.map((cat) => {
      const r = thisWeekData.find((x) => x.category === cat)
      return [cat, { performance: r?.performance ?? '', plan: r?.plan ?? '', issues: r?.issues ?? '' }]
    })
  ) as Record<string, { performance: string; plan: string; issues: string }>

  // 주차별 그룹화
  const grouped = (reports ?? []).reduce<Record<string, WeeklyReport[]>>((acc, r) => {
    if (!acc[r.week_start]) acc[r.week_start] = []
    acc[r.week_start].push(r)
    return acc
  }, {})

  const groups = Object.entries(grouped).map(([weekStart, reps]) => ({
    weekStart,
    reports: reps,
  }))

  return (
    <div style={{ maxWidth: '860px' }}>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1
          style={{
            fontSize: '1.5rem',
            fontWeight: 700,
            color: '#0f172a',
            letterSpacing: '-0.03em',
            margin: 0,
          }}
        >
          주간보고
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>
          주간 성과, 계획, 이슈를 기록합니다
        </p>
      </div>

      {/* 작성 폼 */}
      <div className="card" style={{ padding: '1.5rem', marginBottom: '1.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
          <FileText size={16} color="#6366f1" />
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>
            보고서 작성
          </h2>
        </div>

        {error && (
          <div
            role="alert"
            style={{
              padding: '0.75rem 1rem',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '0.625rem',
              marginBottom: '1rem',
              fontSize: '0.8125rem',
              color: '#b91c1c',
            }}
          >
            {decodeURIComponent(error)}
          </div>
        )}

        {success && (
          <div
            role="status"
            style={{
              padding: '0.75rem 1rem',
              backgroundColor: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '0.625rem',
              marginBottom: '1rem',
              fontSize: '0.8125rem',
              color: '#15803d',
            }}
          >
            주간보고가 저장되었습니다
          </div>
        )}

        <form action={upsertWeeklyReport}>
          <div style={{ marginBottom: '1.25rem', maxWidth: '320px' }}>
            <label htmlFor="week_start" className="label">주차</label>
            <select
              id="week_start"
              name="week_start"
              required
              className="input-field"
              style={{ cursor: 'pointer' }}
            >
              {weekOptions.map((w) => (
                <option key={w} value={w}>
                  {new Date(w).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })} 주
                  {w === thisWeek ? ' (이번 주)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8375rem' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc' }}>
                  <th style={thStyle({ width: '80px' })}>구분</th>
                  <th style={thStyle()}>성과</th>
                  <th style={thStyle()}>계획</th>
                  <th style={thStyle({ width: '22%' })}>이슈/협조사항</th>
                </tr>
              </thead>
              <tbody>
                {CATEGORIES.map((cat, idx) => (
                  <tr key={cat} style={{ backgroundColor: idx % 2 === 1 ? '#fafafa' : '#fff' }}>
                    <td style={tdLabelStyle()}>{cat}</td>
                    <td style={tdStyle()}>
                      <textarea
                        name={`${cat}_performance`}
                        defaultValue={prefill[cat]?.performance}
                        placeholder="이번 주 주요 성과..."
                        rows={4}
                        style={taStyle}
                      />
                    </td>
                    <td style={tdStyle()}>
                      <textarea
                        name={`${cat}_plan`}
                        defaultValue={prefill[cat]?.plan}
                        placeholder="다음 주 계획..."
                        rows={4}
                        style={taStyle}
                      />
                    </td>
                    <td style={tdStyle()}>
                      <textarea
                        name={`${cat}_issues`}
                        defaultValue={prefill[cat]?.issues}
                        placeholder="이슈 또는 협조사항..."
                        rows={4}
                        style={taStyle}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" className="btn-primary">
              <Save size={15} />
              저장
            </button>
          </div>
        </form>
      </div>

      {/* 히스토리 */}
      <div>
        <h2
          style={{
            fontSize: '1rem',
            fontWeight: 600,
            color: '#0f172a',
            marginBottom: '1rem',
            letterSpacing: '-0.01em',
          }}
        >
          과거 주간보고
        </h2>
        <ReportAccordion groups={groups} />
      </div>
    </div>
  )
}
