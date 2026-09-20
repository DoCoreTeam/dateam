'use client'

// app/admin/ai-usage/AiUsageDashboard.tsx — AI 사용량 대시보드
//
// 목록 표준(§2-6)으로 옮겼다: 세 표를 ListSurface 한 벌로 그리고, 요청 로그는 ListPager가 넘긴다.
// 화면 조건(기간·프로바이더)은 URL이 진실이다 — 새로고침·링크 공유에서 같은 화면이 나와야 한다.

import { useEffect, useMemo, useState, useCallback } from 'react'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { TrendingUp, Activity, Database, AlertTriangle, DollarSign, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import { SkelCard } from '@/components/ui/LoadingSkeleton'
import ListSurface from '@/components/ui/list/ListSurface'
import type { FeatureUsage, UsageTotals } from '@/lib/ai/usage-query'
import { useEscClose } from '@/lib/use-esc-close'
import { saveAiBudget } from './actions'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import type { ListDefaults } from '@/lib/ui/list-query'
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

const DAY_OPTIONS = [7, 30, 90]
const DEFAULT_DAYS = 30

// 이 화면의 조건은 전부 URL에 담는다. 표 자체는 정렬이 없으므로 sort는 자리표시용 기본값이다.
const LIST_DEFAULTS: ListDefaults = {
  sort: { key: 'created_at', dir: 'desc' },
  view: 'table',
  size: 20,
  filterKeys: ['provider', 'days'],
}

interface AiUsageDashboardProps {
  providerModelRows: ProviderModelRow[]
  monthLabel: string
  /** 오늘(KST) 날짜 키 */
  todayKey: string
  /** 원장에서 접은 기능별 오늘 사용량 */
  ledgerToday: FeatureUsage[]
  totals: UsageTotals
}

export default function AiUsageDashboard({
  providerModelRows, monthLabel, todayKey, ledgerToday, totals,
}: AiUsageDashboardProps) {
  const { query, set } = useListQuery(LIST_DEFAULTS)
  const days = Number(query.filters.days) || DEFAULT_DAYS
  const providerFilter = query.filters.provider || 'all'
  const logPage = query.page
  const logSize = query.size

  /**
   * **프로바이더 한도(429)** 는 우리 예산 임계치와 다른 것이다.
   *
   * 임계치는 "우리가 정한 선을 넘었다"(우리가 조절할 수 있다),
   * 429 는 "AI 쪽이 더 안 받는다"(우리가 못 고친다 — 기다리거나 모델을 바꿔야 한다).
   * 둘을 같은 배너로 묶으면 관리자가 할 일을 잘못 고른다.
   *
   * 새 엔드포인트를 만들지 않고 시스템 로그(v0.7.583)를 그대로 읽는다.
   */
  const [providerQuota, setProviderQuota] = useState<{ count: number; detail: string } | null>(null)

  const [editing, setEditing] = useState<FeatureUsage | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [features, setFeatures] = useState<FeatureRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [daily, setDaily] = useState<DailyRow[]>([])
  const [logs, setLogs] = useState<LogRow[]>([])
  const [logTotal, setLogTotal] = useState(0)
  const [loading, setLoading] = useState(true)

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
        fetch(`/api/admin/ai-usage/logs?page=${logPage}&limit=${logSize}`).then(r => r.json()),
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
  }, [days, logPage, logSize])

  useEffect(() => { fetchAll() }, [fetchAll])

  useEffect(() => {
    let alive = true
    // 못 읽어도 조용히 넘어간다 — 이 배너가 없다고 사용량 화면이 못 열리면 안 된다
    fetch('/api/admin/system-log?reason=quota&days=1&limit=5')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!alive || !body?.items?.length) return
        const count = body.items.reduce((n: number, i: { count: number }) => n + i.count, 0)
        setProviderQuota({ count, detail: body.items[0].detail as string })
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const daysPicker = (
    <label className="list-filter">
      <span className="sr-only">기간</span>
      <select className="input-field"
        value={days}
        aria-label="기간"
        onChange={(e) => set({ filters: { days: e.target.value } })}
      >
        {DAY_OPTIONS.map((d) => <option key={d} value={d}>최근 {d}일</option>)}
      </select>
    </label>
  )

  // SkelPage는 `loading.tsx`용(스스로 page-inner를 연다). 화면 안에서 쓰면
  // MobileShell의 main.page-inner와 겹쳐 좌우 여백이 두 배가 됐다가 로드 후 되돌아온다.
  if (loading && !summary) {
    return (
      <div>
        <PageHeader title="AI 사용량" description="Gemini 토큰 사용 현황을 모니터링합니다" actions={daysPicker} />
        <SkelCard lines={4} />
      </div>
    )
  }

  const featureUsageColumns: ColumnDef<FeatureUsage>[] = [
    { key: 'feature', header: '기능', primary: true, cell: (u) => <span style={{ fontWeight: 600 }}>{u.feature}</span> },
    { key: 'total', header: '전체', align: 'right', cell: (u) => `${fmt(u.total)}회` },
    { key: 'ok', header: '성공', align: 'right', cell: (u) => fmt(u.ok) },
    { key: 'failed', header: '실패', align: 'right', cell: (u) => fmt(u.failed) },
    {
      key: 'denied', header: '거절', align: 'right',
      // 거절은 «우리가 안 보낸 것»이다. 실패와 같은 색으로 두면 둘이 같은 일로 읽힌다
      cell: (u) => (
        <span title="상한에 걸려 벤더로 나가지 않은 호출" style={u.denied > 0 ? { color: 'var(--warn)' } : undefined}>
          {fmt(u.denied)}
        </span>
      ),
    },
    {
      key: 'remaining', header: '오늘 남은 횟수', align: 'right',
      cell: (u) => {
        // 상한을 모르는 것과 0 은 다른 말이다 — 모르는 것을 0 으로 적으면 거짓말이 된다
        if (!u.limit) return <span style={{ color: 'var(--text-muted)' }} title="이 기능에는 상한이 설정돼 있지 않습니다">상한 없음</span>
        const used = u.total - u.denied
        return (
          <span title={`오늘 ${fmt(used)}/${fmt(u.limit.dailyLimit)}회`} style={u.remaining === 0 ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>
            {fmt(u.remaining ?? 0)} / {fmt(u.limit.dailyLimit)}
          </span>
        )
      },
    },
    {
      key: 'bar', header: '오늘 쓴 비율', hideOnCard: true,
      cell: (u) => {
        // 상한이 없으면 막대도 없다 — 분모를 지어내면 그 막대는 아무 뜻이 없다
        if (!u.limit || u.limit.dailyLimit <= 0) return <span style={{ color: 'var(--text-muted)' }}>상한 없음</span>
        const used = u.total - u.denied
        const pct = Math.min(100, Math.round((used / u.limit.dailyLimit) * 100))
        return (
          <div title={`${fmt(used)}/${fmt(u.limit.dailyLimit)}회 (${pct}%)`}
            style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', height: '0.5rem', minWidth: '5rem' }}>
            <div style={{
              width: `${pct}%`, height: '100%', borderRadius: 'var(--radius-sm)',
              background: pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warn)' : 'var(--brand)',
            }} />
          </div>
        )
      },
    },
    { key: 'inputTokens', header: '입력 토큰', align: 'right', hideOnCard: true, cell: (u) => fmt(u.inputTokens) },
    { key: 'outputTokens', header: '출력 토큰', align: 'right', hideOnCard: true, cell: (u) => fmt(u.outputTokens) },
    {
      key: 'edit', header: '상한', align: 'right',
      cell: (u) => (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(u)}>
          {u.limit ? '바꾸기' : '정하기'}
        </button>
      ),
    },
  ]

  const userColumns: ColumnDef<UserRow>[] = [
    { key: 'name', header: '이름', primary: true, cell: (u) => <span style={{ fontWeight: 600 }}>{u.name}</span> },
    { key: 'total_tokens', header: '이번 달 토큰', align: 'right', cell: (u) => fmt(u.total_tokens) },
    { key: 'call_count', header: '호출 횟수', align: 'right', cell: (u) => `${fmt(u.call_count)}회` },
    {
      key: 'last_at', header: '마지막 사용', hideOnCard: true,
      cell: (u) => new Date(u.last_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    },
  ]

  const costColumns: ColumnDef<ProviderModelRow>[] = [
    { key: 'provider', header: '프로바이더', primary: true, cell: (r) => <span style={{ fontWeight: 600 }}>{providerLabel(r.provider)}</span> },
    { key: 'model', header: '모델', cell: (r) => r.model },
    { key: 'prompt_tokens', header: '프롬프트', align: 'right', hideOnCard: true, cell: (r) => fmt(r.prompt_tokens) },
    { key: 'output_tokens', header: '출력', align: 'right', hideOnCard: true, cell: (r) => fmt(r.output_tokens) },
    {
      key: 'total_tokens', header: '합계', align: 'right',
      cell: (r) => <span style={{ fontWeight: 600, color: 'var(--brand)' }}>{fmt(r.total_tokens)}</span>,
    },
    {
      key: 'cost', header: '추정 비용', align: 'right',
      cell: (r) => {
        const cost = estimateCostUsd(r.model, r.prompt_tokens, r.output_tokens)
        return <span style={{ fontWeight: 600, color: cost == null ? 'var(--text-faint)' : 'var(--text)' }}>{fmtUsd(cost)}</span>
      },
    },
  ]

  const logColumns: ColumnDef<LogRow>[] = [
    {
      key: 'created_at', header: '시각', primary: true,
      cell: (l) => (
        <span style={{ fontSize: 'var(--fs-sm)' }}>
          {new Date(l.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </span>
      ),
    },
    { key: 'feature_label', header: '기능', cell: (l) => l.feature_label },
    { key: 'user_name', header: '유저', cell: (l) => l.user_name },
    { key: 'prompt_tokens', header: '프롬프트', align: 'right', hideOnCard: true, cell: (l) => fmt(l.prompt_tokens) },
    { key: 'output_tokens', header: '출력', align: 'right', hideOnCard: true, cell: (l) => fmt(l.output_tokens) },
    {
      key: 'total_tokens', header: '합계', align: 'right',
      cell: (l) => <span style={{ fontWeight: 600, color: 'var(--brand)' }}>{fmt(l.total_tokens)}</span>,
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      <PageHeader
        title="AI 사용량"
        description="Gemini 토큰 사용 현황을 모니터링합니다"
        actions={daysPicker}
      />

      {/* 임계치 초과 경고 */}
      {summary?.threshold_exceeded && (
        <div role="alert" style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-5)',
          backgroundColor: 'var(--warning-bg)', border: 'var(--hairline) solid var(--warning-border)', borderRadius: 'var(--radius)',
        }}>
          <AlertTriangle size={18} color="var(--warning)" />
          <span style={{ fontSize: 'var(--fs-base)', color: 'var(--warning)', fontWeight: 500 }}>
            이번 달 토큰 사용량이 임계치({fmt(summary.alert_threshold)}개)를 초과했습니다.
          </span>
        </div>
      )}

      {/* 프로바이더가 더 안 받는 상태 — 임계치 초과와 **다른 일**이라 따로 말한다 */}
      {providerQuota && (
        <div role="alert" style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-5)',
          backgroundColor: 'var(--danger-bg)', border: 'var(--hairline) solid var(--danger-border)', borderRadius: 'var(--radius)',
          flexWrap: 'wrap',
        }}>
          <AlertTriangle size={18} color="var(--danger)" />
          <span style={{ fontSize: 'var(--fs-base)', color: 'var(--danger)', fontWeight: 500 }}>
            AI 쪽에서 한도를 넘겼다고 거절한 일이 최근 하루 동안 {providerQuota.count.toLocaleString()}번 있었습니다.
            이건 아래 사용량 임계치와 다른 문제라, 기다리거나 모델을 바꿔야 합니다.
          </span>
          <Link href="/admin/system-log?reason=quota" style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
            color: 'var(--danger)', fontSize: 'var(--fs-sm)', fontWeight: 600,
          }}>
            <ExternalLink size={14} /> 시스템 로그에서 보기
          </Link>
        </div>
      )}

      {/* SummaryCards */}
      <div className="responsive-grid-cols-3" style={{ gap: 'var(--space-4)' }}>
        <div className="card" style={{ padding: 'var(--space-6)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
            <Activity size={16} color="var(--brand)" />
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', fontWeight: 500 }}>오늘 사용량</span>
          </div>
          <div style={{ fontSize: 'var(--fs-3xl)', fontWeight: 700, color: 'var(--text)' }}>{fmt(summary?.today_tokens ?? 0)}</div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 'var(--space-1)' }}>tokens</div>
        </div>
        <div className="card" style={{ padding: 'var(--space-6)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
            <TrendingUp size={16} color="var(--brand)" />
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', fontWeight: 500 }}>이번 달 사용량</span>
          </div>
          <div style={{ fontSize: 'var(--fs-3xl)', fontWeight: 700, color: summary?.threshold_exceeded ? 'var(--danger)' : 'var(--text)' }}>{fmt(summary?.month_tokens ?? 0)}</div>
          <div style={{ marginTop: 'var(--space-2)' }}>
            <div style={{ height: '6px', background: 'var(--color-border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(summary?.month_usage_pct ?? 0, 100)}%`, background: (summary?.month_usage_pct ?? 0) >= 100 ? 'var(--danger)' : 'var(--brand)', borderRadius: 'var(--radius)', transition: 'width 0.3s' }} />
            </div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 'var(--space-1)' }}>{summary?.month_usage_pct ?? 0}% / 임계치 {fmt(summary?.alert_threshold ?? 1000000)}</div>
          </div>
        </div>
        <div className="card" style={{ padding: 'var(--space-6)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
            <Database size={16} color="var(--brand)" />
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', fontWeight: 500 }}>누적 사용량</span>
          </div>
          <div style={{ fontSize: 'var(--fs-3xl)', fontWeight: 700, color: 'var(--text)' }}>{fmt(summary?.total_tokens ?? 0)}</div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 'var(--space-1)' }}>전체 누적 tokens</div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="responsive-grid-cols-2" style={{ gap: 'var(--space-6)' }}>
        {/* 기능별 막대 차트 */}
        <div className="card" style={{ padding: 'var(--space-6)' }}>
          <h2 className="tape-title" style={{ margin: 0 }}>기능별 토큰 사용량</h2>
          {features.length === 0 ? (
            <EmptyState title="아직 기능별 사용 기록이 없어요" description="AI 기능을 사용하면 여기에 집계됩니다" />
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
            <EmptyState title="이 기간에는 사용 기록이 없어요" description="위 기간 선택을 넓혀보세요" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={daily} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--surface-muted)" />
                <XAxis dataKey="date" tick={{ fontSize: 'var(--fs-2xs)', fill: 'var(--text-faint)' }} tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-faint)' }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)} />
                <Tooltip formatter={(v: number) => [fmt(v), '토큰']} labelStyle={{ fontSize: 12 }} contentStyle={{ fontSize: 12, borderRadius: 'var(--radius)', border: 'var(--border-w-2) solid var(--border-color)' }} />
                <Line type="monotone" dataKey="total_tokens" stroke="var(--brand)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* 오늘 원장 — 기능별 호출·거절·남은 횟수 */}
      <div className="card" style={{ padding: 'var(--space-6)' }}>
        <h2 className="tape-title" style={{ margin: 0 }}>오늘 AI 호출 ({todayKey})</h2>
        <p style={{ margin: 'var(--space-2) 0 var(--space-4)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          원장(ai_llm_calls)에서 셉니다. 토큰 집계와 달리 <strong>나가지 않은 호출</strong>도 남습니다.
          상한에 걸려 거절된 것과 벤더가 거절한 것은 뜻이 다르므로 따로 셉니다.
        </p>

        <div style={{
          display: 'grid', gap: 'var(--space-3)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))',
          marginBottom: 'var(--space-4)',
        }}>
          {[
            { label: '전체', value: totals.total, hint: '원장에 남은 줄' },
            { label: '성공', value: totals.ok, hint: '벤더에 닿아 답이 온 것' },
            { label: '실패', value: totals.failed, hint: '벤더까지 갔는데 안 된 것' },
            { label: '거절', value: totals.denied, hint: '상한에 걸려 안 보낸 것' },
            { label: '한도 소진', value: totals.exhausted, hint: '오늘 몫을 다 쓴 기능 수' },
          ].map((m) => (
            <div key={m.label} className="card" style={{ padding: 'var(--space-4)' }} title={m.hint}>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{m.label}</div>
              <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700 }}>{fmt(m.value)}</div>
            </div>
          ))}
        </div>

        <ListSurface
          rows={ledgerToday}
          columns={featureUsageColumns}
          query={query}
          rowKey={(u) => u.feature}
          empty={{ title: '오늘은 아직 호출이 없어요', description: '상한이 설정된 기능은 0건이어도 함께 보입니다' }}
        />
      </div>

      {editing && <BudgetEditor usage={editing} onClose={() => setEditing(null)} />}

      {/* 유저별 테이블 */}
      <div className="card" style={{ padding: 'var(--space-6)' }}>
        <h2 className="tape-title" style={{ margin: 0 }}>유저별 사용량</h2>
        <ListSurface
          rows={users}
          columns={userColumns}
          query={query}
          rowKey={(u) => u.user_id}
          empty={{ title: '아직 사용한 구성원이 없어요', description: 'AI 기능을 사용하면 사용자별로 집계됩니다' }}
        />
      </div>

      {/* provider·model 월 비용 테이블 (세션3 §5-4) */}
      <div className="card" style={{ padding: 'var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <h2 className="tape-title" style={{ margin: 0 }}>프로바이더·모델별 비용 ({monthLabel})</h2>
          <label className="list-filter">
            <span className="sr-only">프로바이더 필터</span>
            <select className="input-field"
              value={providerFilter}
              aria-label="프로바이더 필터"
              onChange={(e) => set({ filters: { provider: e.target.value === 'all' ? '' : e.target.value } })}
            >
              <option value="all">전체 프로바이더</option>
              {providerOptions.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>

        {/* 추정 비용 총합 (강조 — --fs-price) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 'var(--space-4) 0 var(--space-2)' }}>
          <DollarSign size={16} color="var(--brand)" />
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', fontWeight: 500 }}>이번 달 추정 비용</span>
          <span style={{ fontSize: 'var(--fs-price)', fontWeight: 700, color: 'var(--text)' }}>{fmtUsd(totalCostUsd)}</span>
        </div>

        <ListSurface
          rows={filteredRows}
          columns={costColumns}
          query={query}
          rowKey={(r) => `${providerKey(r.provider)}::${r.model}`}
          empty={providerFilter !== 'all'
            ? { title: '이 프로바이더의 사용 기록이 없어요', description: '위 필터를 전체로 바꿔보세요' }
            : { title: '이번 달 사용 기록이 없어요', description: 'AI 기능을 사용하면 모델별 비용이 집계됩니다' }}
        />
      </div>

      {/* Raw 로그 테이블 */}
      <div className="card" style={{ padding: 'var(--space-6)' }}>
        <h2 className="tape-title" style={{ margin: 0 }}>요청 로그</h2>
        <ListSurface
          rows={logs}
          columns={logColumns}
          query={query}
          rowKey={(l) => l.id}
          loading={loading}
          empty={{ title: '요청 기록이 없어요', description: 'AI를 호출하면 요청 하나하나가 여기에 남습니다' }}
        />
        <ListPager query={query} total={logTotal} onChange={set} loading={loading} />
      </div>
    </div>
  )
}


/**
 * 기능 하나의 하루 상한을 고친다.
 *
 * 쓰기는 서버 액션 한 곳을 지난다 — ai_call_budget 에는 쓰기 정책이 없고(마이그 263),
 * 브라우저가 직접 고칠 수 있으면 상한이 상한이 아니다.
 */
function BudgetEditor({ usage, onClose }: { usage: FeatureUsage; onClose: () => void }) {
  const [daily, setDaily] = useState(String(usage.limit?.dailyLimit ?? 30))
  const [perMinute, setPerMinute] = useState(String(usage.limit?.perMinuteLimit ?? 5))
  const [enabled, setEnabled] = useState(usage.limit?.enabled ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEscClose(onClose, !saving)

  async function submit() {
    setSaving(true)
    setError(null)
    const r = await saveAiBudget({
      feature: usage.feature,
      dailyLimit: Number(daily),
      perMinuteLimit: Number(perMinute),
      enabled,
    })
    setSaving(false)
    if (!r.ok) { setError(r.error ?? '저장하지 못했습니다.'); return }
    onClose()
  }

  return (
    <div
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 'var(--z-modal)', backgroundColor: 'var(--modal-backdrop)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-6)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${usage.feature} 하루 상한`}
        style={{
          width: '100%', maxWidth: '26rem', background: 'var(--color-surface)',
          borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-modal)', padding: 'var(--space-5)',
          display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
        }}
      >
        <h2 className="tape-title" style={{ margin: 0 }}>{usage.feature} 상한</h2>
        <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          상한에 닿으면 그 기능의 AI 호출이 거절되고, 사유와 풀리는 시각이 함께 나옵니다.
          줄을 지우는 것과 끄는 것은 다릅니다. 지우면 상한을 모르는 상태가 되어 통과합니다.
        </p>

        <label className="label" htmlFor="ai-budget-daily">하루 상한 (회)</label>
        <input id="ai-budget-daily" className="input-field" inputMode="numeric"
          value={daily} onChange={(e) => setDaily(e.target.value)} />

        <label className="label" htmlFor="ai-budget-minute">분당 상한 (회)</label>
        <input id="ai-budget-minute" className="input-field" inputMode="numeric"
          value={perMinute} onChange={(e) => setPerMinute(e.target.value)} />

        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>이 기능에 AI 를 씁니다</span>
        </label>

        {error && <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>취소</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={saving}>
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
