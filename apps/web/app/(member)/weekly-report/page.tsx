import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWeekStart, toDateString } from '@/lib/utils'
import { subWeeks } from 'date-fns'
import { upsertWeeklyReport } from './actions'
import ReportAccordion from './ReportAccordion'
import { FileText, Save } from 'lucide-react'
import type { WeeklyReport } from '@/types/database'

const CATEGORIES = ['매출', '파이프라인', '기타']

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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
            <div>
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

            <div>
              <label htmlFor="category" className="label">구분</label>
              <select
                id="category"
                name="category"
                required
                className="input-field"
                style={{ cursor: 'pointer' }}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <div>
              <label htmlFor="performance" className="label">성과</label>
              <textarea
                id="performance"
                name="performance"
                rows={4}
                placeholder="이번 주 주요 성과를 작성하세요..."
                className="input-field"
                style={{ resize: 'vertical', minHeight: '100px' }}
              />
            </div>

            <div>
              <label htmlFor="plan" className="label">다음 주 계획</label>
              <textarea
                id="plan"
                name="plan"
                rows={4}
                placeholder="다음 주 계획을 작성하세요..."
                className="input-field"
                style={{ resize: 'vertical', minHeight: '100px' }}
              />
            </div>

            <div>
              <label htmlFor="issues" className="label">이슈/협조사항</label>
              <textarea
                id="issues"
                name="issues"
                rows={3}
                placeholder="이슈 또는 협조가 필요한 사항을 작성하세요..."
                className="input-field"
                style={{ resize: 'vertical', minHeight: '80px' }}
              />
            </div>
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
