import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getWeekStart, toDateString } from '@/lib/utils'
import { addDays } from 'date-fns'
import { insertKpi } from './actions'
import KpiRow from './KpiRow'
import { TrendingUp, Plus, Target, Calendar, Flag, AlertCircle } from 'lucide-react'
import type { KpiEntry } from '@/types/database'

interface KpiPageProps {
  searchParams: Promise<{ error?: string }>
}

interface WeeklyKpiTarget {
  label: string
  target: string
  unit?: string
}

interface OkrItem {
  objective: string
  lead: string
  key_results: string[]
}

export default async function KpiPage({ searchParams }: KpiPageProps) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { error } = await searchParams

  const adminClient = createAdminClient()

  function safeArray<T>(result: PromiseSettledResult<{ data: { value: unknown } | null }>, fallback: T[] = []): T[] {
    if (result.status !== 'fulfilled') return fallback
    const value = result.value.data?.value
    return Array.isArray(value) ? (value as T[]) : fallback
  }

  const [kpiEntriesResult, weeklyKpiResult, h1KpiResult, yearKpiResult, okrResult] = await Promise.allSettled([
    supabase
      .from('kpi_entries')
      .select('*')
      .eq('user_id', user.id)
      .order('period_end', { ascending: false }),
    adminClient.from('org_content').select('value').eq('key', 'kpi_targets').single(),
    adminClient.from('org_content').select('value').eq('key', 'h1_kpi').single(),
    adminClient.from('org_content').select('value').eq('key', 'year_kpi').single(),
    adminClient.from('org_content').select('value').eq('key', 'okr').single(),
  ])

  const kpiEntries = kpiEntriesResult.status === 'fulfilled' ? (kpiEntriesResult.value.data as KpiEntry[] | null) : null
  const weeklyTargets = safeArray<WeeklyKpiTarget>(weeklyKpiResult)
  const h1Kpi = safeArray<string>(h1KpiResult)
  const yearKpi = safeArray<string>(yearKpiResult)
  const okrList = safeArray<OkrItem>(okrResult)

  // 이번 주 월~일
  const weekMonday = getWeekStart(new Date())
  const weekSunday = addDays(weekMonday, 6)
  const weekStart = toDateString(weekMonday)
  const weekEnd = toDateString(weekSunday)

  const hasOrgKpi = weeklyTargets.length > 0 || h1Kpi.length > 0 || yearKpi.length > 0 || okrList.length > 0

  const SECTION_TITLE: React.CSSProperties = {
    fontSize: '0.8125rem',
    fontWeight: 700,
    color: '#64748b',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    margin: '0 0 0.875rem',
  }

  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: 0 }}>
          KPI 관리
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>
          이번 주 실적을 기록하고 추적합니다
        </p>
      </div>

      {/* ── 조직 KPI 목표 참고 ─────────────────────────────── */}
      {hasOrgKpi && (
        <section aria-labelledby="org-kpi-heading" style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <Target size={16} color="#6366f1" />
            <h2 id="org-kpi-heading" style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
              조직 KPI 목표
            </h2>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>참고용 — 관리자가 설정한 목표입니다</span>
          </div>

          <div className="responsive-grid-cols-3" style={{ marginBottom: '1rem' }}>
            {weeklyTargets.length > 0 && (
              <div className="card" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.875rem' }}>
                  <Calendar size={13} color="#6366f1" />
                  <p style={{ ...SECTION_TITLE, margin: 0, color: '#6366f1' }}>주간 공통 KPI</p>
                </div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                  {weeklyTargets.map((kpi, i) => (
                    <li key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.8125rem', color: '#475569', lineHeight: 1.4 }}>{kpi.label}</span>
                      <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#6366f1', flexShrink: 0 }}>{kpi.target}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {h1Kpi.length > 0 && (
              <div className="card" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.875rem' }}>
                  <Flag size={13} color="#0891b2" />
                  <p style={{ ...SECTION_TITLE, margin: 0, color: '#0891b2' }}>상반기 KPI (H1)</p>
                </div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {h1Kpi.map((item, i) => (
                    <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.375rem' }}>
                      <span style={{ color: '#0891b2', flexShrink: 0, marginTop: '0.1em' }}>·</span>
                      <span style={{ fontSize: '0.8125rem', color: '#334155', lineHeight: 1.45 }}>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {yearKpi.length > 0 && (
              <div className="card" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.875rem' }}>
                  <TrendingUp size={13} color="#059669" />
                  <p style={{ ...SECTION_TITLE, margin: 0, color: '#059669' }}>연간 KPI (Year)</p>
                </div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {yearKpi.map((item, i) => (
                    <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.375rem' }}>
                      <span style={{ color: '#059669', flexShrink: 0, marginTop: '0.1em' }}>·</span>
                      <span style={{ fontSize: '0.8125rem', color: '#334155', lineHeight: 1.45 }}>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {okrList.length > 0 && (
            <div className="card" style={{ padding: '1.25rem' }}>
              <p style={{ ...SECTION_TITLE, color: '#7c3aed' }}>분기 OKR</p>
              <div className="responsive-grid-cols-2">
                {okrList.map((okr, i) => (
                  <div key={i} style={{ borderLeft: '3px solid #7c3aed', paddingLeft: '0.875rem', paddingTop: '0.25rem', paddingBottom: '0.25rem' }}>
                    <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0f172a', margin: '0 0 0.25rem', lineHeight: 1.4 }}>
                      {okr.objective}
                    </p>
                    <p style={{ fontSize: '0.6875rem', color: '#94a3b8', margin: '0 0 0.5rem', fontWeight: 500 }}>
                      Lead · {okr.lead}
                    </p>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {okr.key_results?.map((kr, j) => (
                        <li key={j} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.375rem' }}>
                          <span style={{ color: '#7c3aed', flexShrink: 0, fontSize: '0.75rem' }}>KR{j + 1}</span>
                          <span style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.45 }}>{kr}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── 이번 주 실적 입력 ─────────────────────────────── */}
      <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
          <Plus size={16} color="#6366f1" />
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>
            이번 주 실적 입력
          </h2>
          <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginLeft: '0.25rem' }}>
            {weekStart} ~ {weekEnd}
          </span>
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
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <AlertCircle size={14} />
            {decodeURIComponent(error)}
          </div>
        )}

        {weeklyTargets.length === 0 && h1Kpi.length === 0 && yearKpi.length === 0 ? (
          <p style={{ fontSize: '0.875rem', color: '#94a3b8', margin: 0, padding: '1rem 0' }}>
            관리자가 KPI 항목을 설정하지 않았습니다. 관리자에게 문의하세요.
          </p>
        ) : (
          <form action={insertKpi}>
            {/* 기간 자동 세팅 — 이번 주 */}
            <input type="hidden" name="period_start" value={weekStart} />
            <input type="hidden" name="period_end" value={weekEnd} />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.875rem', alignItems: 'end' }} className="responsive-grid-cols-3">
              <div>
                <label htmlFor="kpi_metric_ref" className="label">KPI 항목</label>
                <select
                  id="kpi_metric_ref"
                  name="kpi_metric_ref"
                  required
                  defaultValue=""
                  className="input-field"
                  style={{ cursor: 'pointer' }}
                >
                  <option value="" disabled>항목 선택</option>
                  {weeklyTargets.length > 0 && (
                    <optgroup label="주간 KPI">
                      {weeklyTargets.map((kpi, i) => (
                        <option key={i} value={`kpi_targets:${i}`}>
                          {kpi.label} (목표: {kpi.target})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {h1Kpi.length > 0 && (
                    <optgroup label="상반기 KPI (H1)">
                      {h1Kpi.map((item, i) => (
                        <option key={i} value={`h1_kpi:${i}`}>{item}</option>
                      ))}
                    </optgroup>
                  )}
                  {yearKpi.length > 0 && (
                    <optgroup label="연간 KPI">
                      {yearKpi.map((item, i) => (
                        <option key={i} value={`year_kpi:${i}`}>{item}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              <div>
                <label htmlFor="value" className="label">실적 값</label>
                <input
                  id="value"
                  name="value"
                  type="number"
                  step="any"
                  min="0"
                  required
                  placeholder="0"
                  className="input-field"
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button type="submit" className="btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                  <Plus size={15} />
                  기록
                </button>
              </div>
            </div>
          </form>
        )}
      </div>

      {/* ── KPI 히스토리 ───────────────────────────────────── */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <TrendingUp size={16} color="#6366f1" />
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>
            실적 히스토리
          </h2>
          <span className="badge badge-slate" style={{ marginLeft: '0.25rem' }}>
            {kpiEntries?.length ?? 0}건
          </span>
        </div>

        {kpiEntries && kpiEntries.length > 0 ? (
          <div className="table-responsive">
            <table className="table-base table-card">
              <thead>
                <tr>
                  <th>KPI 항목</th>
                  <th>실적</th>
                  <th>단위</th>
                  <th>주차</th>
                  <th style={{ width: '90px' }}></th>
                </tr>
              </thead>
              <tbody>
                {kpiEntries.map((kpi) => (
                  <KpiRow key={kpi.id} entry={kpi} weeklyTargets={weeklyTargets} h1Kpi={h1Kpi} yearKpi={yearKpi} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem 1rem', color: '#94a3b8', textAlign: 'center' }}>
            <TrendingUp size={36} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
            <p style={{ margin: 0, fontSize: '0.875rem' }}>아직 등록된 실적이 없습니다</p>
          </div>
        )}
      </div>
    </div>
  )
}
