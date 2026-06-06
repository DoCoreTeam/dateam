'use client'

import { useEffect, useState, useCallback } from 'react'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { TrendingUp, Activity, Database, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react'

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

export default function AiUsageDashboard() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [features, setFeatures] = useState<FeatureRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [daily, setDaily] = useState<DailyRow[]>([])
  const [logs, setLogs] = useState<LogRow[]>([])
  const [logTotal, setLogTotal] = useState(0)
  const [logPage, setLogPage] = useState(1)
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)

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

  if (loading && !summary) return <div style={{ padding: '2rem', color: '#64748b' }}>불러오는 중...</div>

  const totalPages = Math.ceil(logTotal / 20)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: 0 }}>AI 사용량</h1>
          <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>Gemini 토큰 사용 현황을 모니터링합니다</p>
        </div>
        <select
          value={days}
          onChange={e => setDays(Number(e.target.value))}
          style={{ padding: '0.5rem 0.75rem', border: '2px solid var(--border-color)', borderRadius: 'var(--radius)', fontSize: '0.875rem', color: '#374151', background: '#fff' }}
        >
          <option value={7}>최근 7일</option>
          <option value={30}>최근 30일</option>
          <option value={90}>최근 90일</option>
        </select>
      </div>

      {/* 임계치 초과 경고 */}
      {summary?.threshold_exceeded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.875rem 1.25rem', backgroundColor: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 'var(--radius)' }}>
          <AlertTriangle size={18} color="#d97706" />
          <span style={{ fontSize: '0.9rem', color: '#92400e', fontWeight: 500 }}>
            이번 달 토큰 사용량이 임계치({fmt(summary.alert_threshold)}개)를 초과했습니다.
          </span>
        </div>
      )}

      {/* SummaryCards */}
      <div className="responsive-grid-cols-3" style={{ gap: '1rem' }}>
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <Activity size={16} color="var(--brand)" />
            <span style={{ fontSize: '0.8125rem', color: '#64748b', fontWeight: 500 }}>오늘 사용량</span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0f172a' }}>{fmt(summary?.today_tokens ?? 0)}</div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>tokens</div>
        </div>
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <TrendingUp size={16} color="var(--brand)" />
            <span style={{ fontSize: '0.8125rem', color: '#64748b', fontWeight: 500 }}>이번 달 사용량</span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: summary?.threshold_exceeded ? '#dc2626' : '#0f172a' }}>{fmt(summary?.month_tokens ?? 0)}</div>
          <div style={{ marginTop: '0.5rem' }}>
            <div style={{ height: '6px', background: 'var(--color-border)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(summary?.month_usage_pct ?? 0, 100)}%`, background: (summary?.month_usage_pct ?? 0) >= 100 ? '#dc2626' : 'var(--brand)', borderRadius: '3px', transition: 'width 0.3s' }} />
            </div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>{summary?.month_usage_pct ?? 0}% / 임계치 {fmt(summary?.alert_threshold ?? 1000000)}</div>
          </div>
        </div>
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <Database size={16} color="var(--brand)" />
            <span style={{ fontSize: '0.8125rem', color: '#64748b', fontWeight: 500 }}>누적 사용량</span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0f172a' }}>{fmt(summary?.total_tokens ?? 0)}</div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>전체 누적 tokens</div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="responsive-grid-cols-2" style={{ gap: '1.5rem' }}>
        {/* 기능별 막대 차트 */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', marginBottom: '1.25rem', marginTop: 0 }}>기능별 토큰 사용량</h2>
          {features.length === 0 ? (
            <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '0.875rem' }}>데이터 없음</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={features} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)} />
                <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip formatter={(v: number) => [fmt(v), '토큰']} labelStyle={{ fontSize: 12 }} contentStyle={{ fontSize: 12, borderRadius: 'var(--radius)', border: '2px solid var(--border-color)' }} />
                <Bar dataKey="total_tokens" fill="var(--brand)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 일별 라인 차트 */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', marginBottom: '1.25rem', marginTop: 0 }}>일별 사용량 추이 ({days}일)</h2>
          {daily.length === 0 ? (
            <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '0.875rem' }}>데이터 없음</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={daily} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)} />
                <Tooltip formatter={(v: number) => [fmt(v), '토큰']} labelStyle={{ fontSize: 12 }} contentStyle={{ fontSize: 12, borderRadius: 'var(--radius)', border: '2px solid var(--border-color)' }} />
                <Line type="monotone" dataKey="total_tokens" stroke="var(--brand)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* 유저별 테이블 */}
      <div className="card" style={{ padding: '1.5rem' }}>
        <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', marginBottom: '1.25rem', marginTop: 0 }}>유저별 사용량</h2>
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
              <tr><td colSpan={4} style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem' }}>데이터 없음</td></tr>
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

      {/* Raw 로그 테이블 */}
      <div className="card" style={{ padding: '1.5rem' }}>
        <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', marginBottom: '1.25rem', marginTop: 0 }}>요청 로그</h2>
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
              <tr><td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem' }}>데이터 없음</td></tr>
            ) : logs.map((l) => (
              <tr key={l.id}>
                <td className="card-header"><span style={{ fontSize: '0.8125rem' }}>{new Date(l.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></td>
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', marginTop: '1rem' }}>
            <button onClick={() => setLogPage(p => Math.max(1, p - 1))} disabled={logPage <= 1} style={{ padding: '0.375rem', border: '2px solid var(--border-color)', borderRadius: '0.375rem', background: '#fff', cursor: logPage <= 1 ? 'not-allowed' : 'pointer', opacity: logPage <= 1 ? 0.4 : 1 }}>
              <ChevronLeft size={16} />
            </button>
            <span style={{ fontSize: '0.875rem', color: '#64748b' }}>{logPage} / {totalPages}</span>
            <button onClick={() => setLogPage(p => Math.min(totalPages, p + 1))} disabled={logPage >= totalPages} style={{ padding: '0.375rem', border: '2px solid var(--border-color)', borderRadius: '0.375rem', background: '#fff', cursor: logPage >= totalPages ? 'not-allowed' : 'pointer', opacity: logPage >= totalPages ? 0.4 : 1 }}>
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
