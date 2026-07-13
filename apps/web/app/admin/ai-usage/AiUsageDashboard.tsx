'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { TrendingUp, Activity, Database, AlertTriangle, ChevronLeft, ChevronRight, DollarSign } from 'lucide-react'
import { estimateCostUsd } from '@/lib/ai-chat/pricing'

// 세션3 §5-4 — provider·model별 월 토큰 합계 행(서버 page.tsx에서 집계 후 주입). provider null = legacy Gemini.
export interface ProviderModelRow {
  provider: string | null
  model: string
  prompt_tokens: number
  output_tokens: number
  total_tokens: number
  call_count: number
}

interface Summary {
  today_tokens: number
  month_tokens: number
  total_tokens: number
  alert_threshold: number
  month_usage_pct: number
  threshold_exceeded: boolean
}

interface FeatureRow { feature: string; label: string; total_tokens: number; call_count: number }
interface UserRow { user_id: string; name: string; total_tokens: number; call_count: number; last_at: string }
interface DailyRow { date: string; total_tokens: number }
interface LogRow { id: string; created_at: string; user_name: string; feature_label: string; model: string; prompt_tokens: number; output_tokens: number; total_tokens: number }

const fmt = (n: number) => n.toLocaleString('ko-KR')

// provider 표시 라벨 — null(=legacy Gemini) 포함
const PROVIDER_LABELS: Record<string, string> = { gemini: 'Gemini', claude: 'Claude', openai: 'OpenAI' }
const providerLabel = (p: string | null) => (p == null ? 'legacy Gemini' : PROVIDER_LABELS[p] ?? p)
const providerKey = (p: string | null) => p ?? 'legacy'

// 추정 비용(USD) 표기 — 미등록 모델은 null → '-'. 극소액은 '<$0.01'.
const fmtUsd = (c: number | null) => (c == null ? '-' : c === 0 ? '$0.00' : c < 0.01 ? '<$0.01' : `$${c.toFixed(2)}`)

interface AiUsageDashboardProps {
  providerModelRows: ProviderModelRow[]
  monthLabel: string
}

export default function AiUsageDashboard({ providerModelRows, monthLabel }: AiUsageDashboardProps) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [features, setFeatures] = useState<FeatureRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [daily, setDaily] = useState<DailyRow[]>([])
  const [logs, setLogs] = useState<LogRow[]>([])
  const [logTotal, setLogTotal] = useState(0)
  const [logPage, setLogPage] = useState(1)
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [providerFilter, setProviderFilter] = useState<string>('all') // 'all' | providerKey

  // provider 필터 옵션(행에 등장한 provider만) + 선택 필터 적용
  const providerOptions = useMemo(() => {
    const seen = new Map<string, string>() // key → label
    for (const r of providerModelRows) seen.set(providerKey(r.provider), providerLabel(r.provider))
    return Array.from(seen, ([key, label]) => ({ key, label }))
  }, [providerModelRows])

  const filteredRows = useMemo(
    () => (providerFilter === 'all' ? providerModelRows : providerModelRows.filter((r) => providerKey(r.provider) === providerFilter)),
    [providerModelRows, providerFilter],
  )

  // 추정 비용 총합(등록 모델만 합산)
  const totalCostUsd = useMemo(
    () => filteredRows.reduce((sum, r) => sum + (estimateCostUsd(r.model, r.prompt_tokens, r.output_tokens) ?? 0), 0),
    [filteredRows],
  )

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [s, f, u, d, l] = await Promise.all([
        fetch('/api/admin/ai-usage/summary').then(r => r.json()),
        fetch('/api/admin/ai-usage/by-feature').then(r => r.json()),
        fetch('/api/admin/ai-usage/by-user').then(r => r.json()),
        fetch(`/api/admin/ai-usage/daily?days=${days}`).then(r => r.json()),
        fetch(`/api/admin/ai-usage/logs?page=${logPage}&limit=20`).then(r => r.json()),
      ])
      setSummary(s)
      setFeatures(Array.isArray(f) ? f : [])
      setUsers(Array.isArray(u) ? u : [])
      setDaily(Array.isArray(d) ? d : [])
      setLogs(Array.isArray(l.data) ? l.data : [])
      setLogTotal(l.total ?? 0)
    } finally {
      setLoading(false)
    }
  }, [days, logPage])

  useEffect(() => { fetchAll() }, [fetchAll])

  if (loading && !summary) return <div style={{ padding: 'var(--space-8)', color: 'var(--text-muted)' }}>불러오는 중...</div>

  const totalPages = Math.ceil(logTotal / 20)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div>
          <h1 style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.03em', margin: 0 }}>AI 사용량</h1>
          <p style={{ color: 'var(--text-muted)', marginTop: '0.375rem', fontSize: '0.9rem' }}>Gemini 토큰 사용 현황을 모니터링합니다</p>
        </div>
        <select
          value={days}
          onChange={e => setDays(Number(e.target.value))}
          style={{ padding: 'var(--space-2) var(--space-3)', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', fontSize: 'var(--fs-base)', color: 'var(--text)', background: '#fff' }}
        >
          <option value={7}>최근 7일</option>
          <option value={30}>최근 30일</option>
          <option value={90}>최근 90일</option>
        </select>
      </div>

      {/* 임계치 초과 경고 */}
      {summary?.threshold_exceeded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: '0.875rem 1.25rem', backgroundColor: 'var(--warning-bg)', border: 'var(--hairline) solid #fcd34d', borderRadius: 'var(--radius)' }}>
          <AlertTriangle size={18} color="var(--warning)" />
          <span style={{ fontSize: '0.9rem', color: 'var(--warning)', fontWeight: 500 }}>
            이번 달 토큰 사용량이 임계치({fmt(summary.alert_threshold)}개)를 초과했습니다.
          </span>
        </div>
      )}

      {/* SummaryCards */}
      <div className="responsive-grid-cols-3" style={{ gap: 'var(--space-4)' }}>
        <div className="card" style={{ padding: 'var(--space-6)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '0.75rem' }}>
            <Activity size={16} color="var(--brand)" />
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', fontWeight: 500 }}>오늘 사용량</span>
          </div>
          <div style={{ fontSize: 'var(--fs-3xl)', fontWeight: 700, color: 'var(--text)' }}>{fmt(summary?.today_tokens ?? 0)}</div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: '0.25rem' }}>tokens</div>
        </div>
        <div className="card" style={{ padding: 'var(--space-6)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '0.75rem' }}>
            <TrendingUp size={16} color="var(--brand)" />
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', fontWeight: 500 }}>이번 달 사용량</span>
          </div>
          <div style={{ fontSize: 'var(--fs-3xl)', fontWeight: 700, color: summary?.threshold_exceeded ? 'var(--danger)' : 'var(--text)' }}>{fmt(summary?.month_tokens ?? 0)}</div>
          <div style={{ marginTop: '0.5rem' }}>
            <div style={{ height: '6px', background: 'var(--color-border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(summary?.month_usage_pct ?? 0, 100)}%`, background: (summary?.month_usage_pct ?? 0) >= 100 ? 'var(--danger)' : 'var(--brand)', borderRadius: 'var(--radius)', transition: 'width 0.3s' }} />
            </div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: '0.25rem' }}>{summary?.month_usage_pct ?? 0}% / 임계치 {fmt(summary?.alert_threshold ?? 1000000)}</div>
          </div>
        </div>
        <div className="card" style={{ padding: 'var(--space-6)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '0.75rem' }}>
            <Database size={16} color="var(--brand)" />
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', fontWeight: 500 }}>누적 사용량</span>
          </div>
          <div style={{ fontSize: 'var(--fs-3xl)', fontWeight: 700, color: 'var(--text)' }}>{fmt(summary?.total_tokens ?? 0)}</div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: '0.25rem' }}>전체 누적 tokens</div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="responsive-grid-cols-2" style={{ gap: 'var(--space-6)' }}>
        {/* 기능별 막대 차트 */}
        <div className="card" style={{ padding: 'var(--space-6)' }}>
          <h2 className="tape-title" style={{ margin: 0 }}>기능별 토큰 사용량</h2>
          {features.length === 0 ? (
            <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: 'var(--fs-base)' }}>데이터 없음</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={features} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--surface-muted)" />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-faint)' }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)} />
                <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                <Tooltip formatter={(v: number) => [fmt(v), '토큰']} labelStyle={{ fontSize: 12 }} contentStyle={{ fontSize: 12, borderRadius: 'var(--radius)', border: 'var(--border-w-2) solid var(--border-color)' }} />
                <Bar dataKey="total_tokens" fill="var(--brand)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 일별 라인 차트 */}
        <div className="card" style={{ padding: 'var(--space-6)' }}>
          <h2 className="tape-title" style={{ margin: 0 }}>일별 사용량 추이 ({days}일)</h2>
          {daily.length === 0 ? (
            <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: 'var(--fs-base)' }}>데이터 없음</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={daily} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--surface-muted)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-faint)' }} tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-faint)' }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)} />
                <Tooltip formatter={(v: number) => [fmt(v), '토큰']} labelStyle={{ fontSize: 12 }} contentStyle={{ fontSize: 12, borderRadius: 'var(--radius)', border: 'var(--border-w-2) solid var(--border-color)' }} />
                <Line type="monotone" dataKey="total_tokens" stroke="var(--brand)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* 유저별 테이블 */}
      <div className="card" style={{ padding: 'var(--space-6)' }}>
        <h2 className="tape-title" style={{ margin: 0 }}>유저별 사용량</h2>
        <table className="table-base table-card">
          <thead>
            <tr>
              <th>이름</th>
              <th>이번 달 토큰</th>
              <th>호출 횟수</th>
              <th>마지막 사용</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-faint)', padding: 'var(--space-8)' }}>데이터 없음</td></tr>
            ) : users.map((u) => (
              <tr key={u.user_id}>
                <td className="card-header"><span style={{ fontWeight: 600 }}>{u.name}</span></td>
                <td data-label="토큰">{fmt(u.total_tokens)}</td>
                <td data-label="호출">{fmt(u.call_count)}회</td>
                <td data-label="마지막 사용" className="card-hide">{new Date(u.last_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* provider·model 월 비용 테이블 (세션3 §5-4) */}
      <div className="card" style={{ padding: 'var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <h2 className="tape-title" style={{ margin: 0 }}>프로바이더·모델별 비용 ({monthLabel})</h2>
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            aria-label="프로바이더 필터"
            style={{ padding: 'var(--space-2) var(--space-3)', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', fontSize: 'var(--fs-base)', color: 'var(--text)', background: 'var(--surface-bg)' }}
          >
            <option value="all">전체 프로바이더</option>
            {providerOptions.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* 추정 비용 총합 (강조 — --fs-price) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 'var(--space-4) 0 var(--space-2)' }}>
          <DollarSign size={16} color="var(--brand)" />
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', fontWeight: 500 }}>이번 달 추정 비용</span>
          <span style={{ fontSize: 'var(--fs-price)', fontWeight: 700, color: 'var(--text)' }}>{fmtUsd(totalCostUsd)}</span>
        </div>

        <table className="table-base table-card">
          <thead>
            <tr>
              <th>프로바이더</th>
              <th>모델</th>
              <th>프롬프트</th>
              <th>출력</th>
              <th>합계</th>
              <th>추정 비용</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-faint)', padding: 'var(--space-8)' }}>데이터 없음</td></tr>
            ) : filteredRows.map((r) => {
              const cost = estimateCostUsd(r.model, r.prompt_tokens, r.output_tokens)
              return (
                <tr key={`${providerKey(r.provider)}::${r.model}`}>
                  <td className="card-header"><span style={{ fontWeight: 600 }}>{providerLabel(r.provider)}</span></td>
                  <td data-label="모델">{r.model}</td>
                  <td data-label="프롬프트" className="card-hide">{fmt(r.prompt_tokens)}</td>
                  <td data-label="출력" className="card-hide">{fmt(r.output_tokens)}</td>
                  <td data-label="합계" style={{ fontWeight: 600, color: 'var(--brand)' }}>{fmt(r.total_tokens)}</td>
                  <td data-label="추정 비용" style={{ fontWeight: 600, color: cost == null ? 'var(--text-faint)' : 'var(--text)' }}>{fmtUsd(cost)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Raw 로그 테이블 */}
      <div className="card" style={{ padding: 'var(--space-6)' }}>
        <h2 className="tape-title" style={{ margin: 0 }}>요청 로그</h2>
        <table className="table-base table-card">
          <thead>
            <tr>
              <th>시각</th>
              <th>기능</th>
              <th>유저</th>
              <th>프롬프트</th>
              <th>출력</th>
              <th>합계</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-faint)', padding: 'var(--space-8)' }}>데이터 없음</td></tr>
            ) : logs.map((l) => (
              <tr key={l.id}>
                <td className="card-header"><span style={{ fontSize: 'var(--fs-sm)' }}>{new Date(l.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></td>
                <td data-label="기능">{l.feature_label}</td>
                <td data-label="유저">{l.user_name}</td>
                <td data-label="프롬프트" className="card-hide">{fmt(l.prompt_tokens)}</td>
                <td data-label="출력" className="card-hide">{fmt(l.output_tokens)}</td>
                <td data-label="합계" style={{ fontWeight: 600, color: 'var(--brand)' }}>{fmt(l.total_tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)', marginTop: '1rem' }}>
            <button onClick={() => setLogPage(p => Math.max(1, p - 1))} disabled={logPage <= 1} style={{ padding: '0.375rem', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', background: '#fff', cursor: logPage <= 1 ? 'not-allowed' : 'pointer', opacity: logPage <= 1 ? 0.4 : 1 }}>
              <ChevronLeft size={16} />
            </button>
            <span style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)' }}>{logPage} / {totalPages}</span>
            <button onClick={() => setLogPage(p => Math.min(totalPages, p + 1))} disabled={logPage >= totalPages} style={{ padding: '0.375rem', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', background: '#fff', cursor: logPage >= totalPages ? 'not-allowed' : 'pointer', opacity: logPage >= totalPages ? 0.4 : 1 }}>
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
