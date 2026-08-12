'use client'

// app/(member)/api-keys/page.tsx — 외부 연동용 API 키 관리
// 목록 표준(§2-6)을 따른다: useListQuery(URL이 진실) + ListToolbar/ListSurface/ListPager.
// 예전 판은 화면 전용 다크 하드코딩(hex·rgba)이라 라이트 테마에서 글자가 사라졌다 → 전부 토큰으로.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Plus, Trash2, Copy, Check, ExternalLink, AlertTriangle } from 'lucide-react'
import { isEnterKey } from '@/lib/ui/ime'
import PageHeader from '@/components/ui/PageHeader'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import { rangeOf, type ListDefaults } from '@/lib/ui/list-query'

interface ApiKey {
  id: string
  name: string
  masked_key: string
  raw_key?: string
  status: 'active' | 'revoked'
  created_at: string
  last_used_at: string | null
  request_count: number
  rate_limit_per_minute: number
}

interface NewKeyResult {
  id: string
  name: string
  key: string
  note: string
}

const LIST_DEFAULTS: ListDefaults = {
  sort: { key: 'created_at', dir: 'desc' },
  view: 'table',
  filterKeys: ['status'],
}
const SORT_OPTIONS = [
  { key: 'created_at', label: '생성일' },
  { key: 'name', label: '이름' },
  { key: 'last_used_at', label: '마지막 사용' },
  { key: 'request_count', label: '요청 수' },
]
const FILTERS = [{
  key: 'status',
  label: '상태',
  options: [{ value: 'active', label: '사용 중' }, { value: 'revoked', label: '폐기됨' }],
}]

function fmtDate(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function ApiKeysPage() {
  const { query, set } = useListQuery(LIST_DEFAULTS, { persistKey: '/api-keys' })

  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const [newKeyResult, setNewKeyResult] = useState<NewKeyResult | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [revokeConfirm, setRevokeConfirm] = useState<string | null>(null)

  const fetchKeys = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/user/api-keys')
      if (res.redirected || res.status === 401 || res.url.includes('/login')) {
        setLoadError('세션이 만료되었습니다. 다시 로그인한 뒤 새로고침해주세요.')
        return
      }
      const data = await res.json().catch(() => null)
      if (data?.success) {
        setKeys(data.data)
        setLoadError(null)
      } else {
        setLoadError('목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.')
      }
    } catch {
      setLoadError('네트워크 오류로 목록을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchKeys() }, [fetchKeys])

  // 세션 만료 시 미들웨어가 /login(HTML)로 리다이렉트하므로 res.json()이 조용히 throw됨.
  // 비-JSON/리다이렉트 응답을 감지해 명확히 안내한다(silent failure 방지).
  function isAuthRedirect(res: Response): boolean {
    return res.redirected || res.status === 401 || res.url.includes('/login')
  }

  async function createKey() {
    if (!newKeyName.trim()) {
      // 빈 이름 클릭 시 죽은 버튼처럼 무반응하지 말고 즉시 안내 + 포커스
      setCreateError('키 이름을 입력해주세요.')
      nameInputRef.current?.focus()
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/user/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName.trim() }),
      })
      if (isAuthRedirect(res)) {
        setCreateError('세션이 만료되었습니다. 다시 로그인한 뒤 시도해주세요.')
        return
      }
      const data = await res.json().catch(() => null)
      if (data?.success) {
        setNewKeyResult(data.data)
        setShowCreate(false)
        setNewKeyName('')
        fetchKeys()
      } else {
        setCreateError(data?.error ?? `키 생성에 실패했습니다 (HTTP ${res.status}).`)
      }
    } catch {
      setCreateError('네트워크 오류로 키 생성에 실패했습니다. 잠시 후 다시 시도해주세요.')
    } finally {
      setCreating(false)
    }
  }

  async function revokeKey(id: string) {
    try {
      const res = await fetch(`/api/user/api-keys/${id}`, { method: 'DELETE' })
      if (isAuthRedirect(res)) {
        alert('세션이 만료되었습니다. 다시 로그인한 뒤 시도해주세요.')
        return
      }
      const data = await res.json().catch(() => null)
      if (data?.success) {
        setRevokeConfirm(null)
        fetchKeys()
      } else {
        alert(data?.error ?? `키 폐기에 실패했습니다 (HTTP ${res.status}).`)
      }
    } catch {
      alert('네트워크 오류로 키 폐기에 실패했습니다. 잠시 후 다시 시도해주세요.')
    }
  }

  function copyText(text: string, id: string) {
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
    try {
      navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;opacity:0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
  }

  // 검색·필터·정렬은 URL(useListQuery)이 진실. 전량 보유 목록이라 여기서 접는다.
  const filtered = useMemo(() => {
    const q = query.q.trim().toLowerCase()
    const status = query.filters.status
    const rows = keys.filter((k) => {
      if (status && k.status !== status) return false
      if (q && !k.name.toLowerCase().includes(q) && !k.masked_key.toLowerCase().includes(q)) return false
      return true
    })
    const dir = query.sort.dir === 'asc' ? 1 : -1
    const key = query.sort.key
    return [...rows].sort((a, b) => {
      if (key === 'name') return a.name.localeCompare(b.name) * dir
      if (key === 'request_count') return (a.request_count - b.request_count) * dir
      if (key === 'last_used_at') return ((a.last_used_at ?? '').localeCompare(b.last_used_at ?? '')) * dir
      return a.created_at.localeCompare(b.created_at) * dir
    })
  }, [keys, query.q, query.filters.status, query.sort.key, query.sort.dir])

  const { from, to } = rangeOf(query)
  const rows = filtered.slice(from, to + 1)
  const hasCondition = Boolean(query.q) || Boolean(query.filters.status)

  const columns: ColumnDef<ApiKey>[] = [
    {
      key: 'name', header: '이름', primary: true, sortable: 'name',
      cell: (k) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, color: 'var(--text)', fontSize: 'var(--fs-md)' }}>{k.name}</span>
          <span className="badge" data-status={k.status === 'active' ? 'done' : 'blocker'}>
            {k.status === 'active' ? '사용 중' : '폐기됨'}
          </span>
        </div>
      ),
    },
    {
      key: 'masked_key', header: '키',
      cell: (k) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <code style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>{k.masked_key}</code>
          {k.status === 'active' && (
            <button
              type="button"
              className="btn-ghost"
              title={k.raw_key ? 'API 키 복사' : '원문 없음 — 새 키 생성 필요'}
              onClick={(e) => {
                e.stopPropagation()
                if (k.raw_key) copyText(k.raw_key, `${k.id}-copy`)
                else alert('이전에 생성된 키는 원문을 불러올 수 없습니다. 기존 키를 폐기하고 새 키를 생성해주세요.')
              }}
              style={{ display: 'inline-flex', alignItems: 'center', opacity: k.raw_key ? 1 : 0.5 }}
            >
              {copiedId === `${k.id}-copy` ? <Check size={12} /> : <Copy size={12} />}
            </button>
          )}
        </span>
      ),
    },
    { key: 'created_at', header: '생성일', sortable: 'created_at', cell: (k) => fmtDate(k.created_at) },
    { key: 'last_used_at', header: '마지막 사용', sortable: 'last_used_at', cell: (k) => fmtDate(k.last_used_at) },
    {
      key: 'request_count', header: '요청', sortable: 'request_count', align: 'right',
      cell: (k) => `${k.request_count.toLocaleString()}회`,
    },
    {
      key: 'rate_limit_per_minute', header: '분당 한도', align: 'right', hideOnCard: true,
      cell: (k) => `${k.rate_limit_per_minute} req/min`,
    },
    {
      key: 'actions', header: '관리',
      cell: (k) => k.status !== 'active' ? <span style={{ color: 'var(--text-faint)' }}>—</span> : (
        <span style={{ display: 'inline-flex', gap: 'var(--space-1)' }} onClick={(e) => e.stopPropagation()}>
          {revokeConfirm === k.id ? (
            <>
              <button type="button" className="btn-primary" onClick={() => revokeKey(k.id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                <AlertTriangle size={13} /> 확인
              </button>
              <button type="button" className="btn-ghost" onClick={() => setRevokeConfirm(null)}>취소</button>
            </>
          ) : (
            <button type="button" className="btn-ghost" onClick={() => setRevokeConfirm(k.id)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: 'var(--danger)' }}>
              <Trash2 size={13} /> 폐기
            </button>
          )}
        </span>
      ),
    },
  ]

  return (
    <div className="page-inner">
      <PageHeader
        title="API Keys"
        description="GPU 가격 데이터에 프로그램으로 접근할 키를 만들고 관리합니다"
        actions={
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <a href="/develop" target="_blank" rel="noreferrer" className="btn-ghost"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none', minHeight: 44 }}>
              API 문서 <ExternalLink size={13} />
            </a>
            <button type="button" className="btn-primary" onClick={() => setShowCreate(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', minHeight: 44 }}>
              <Plus size={16} /> 새 키 생성
            </button>
          </div>
        }
      />

      {/* 생성 직후 1회 노출 — 원문 키 복사 */}
      {newKeyResult && (
        <div className="card" role="status"
          style={{ padding: 'var(--space-4) var(--space-5)', marginBottom: 'var(--space-5)', borderColor: 'var(--success-border)', background: 'var(--success-bg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
            <Check size={16} color="var(--success)" />
            <strong style={{ color: 'var(--success)' }}>API 키가 생성됐습니다 — 지금 복사하세요</strong>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', margin: '0 0 var(--space-3)' }}>
            이 키는 API Keys 페이지에서 다시 복사할 수 있습니다.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', background: 'var(--color-surface)', borderRadius: 'var(--radius)', padding: 'var(--space-2) var(--space-3)', border: 'var(--hairline) solid var(--border-light)' }}>
            <code style={{ flex: 1, fontSize: 'var(--fs-sm)', color: 'var(--text)', wordBreak: 'break-all', fontFamily: 'ui-monospace, monospace' }}>{newKeyResult.key}</code>
            <button type="button" className="btn-ghost" onClick={() => copyText(newKeyResult.key, 'newkey')} aria-label="새 키 복사" style={{ flexShrink: 0 }}>
              {copiedId === 'newkey' ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
          <button type="button" className="btn-ghost" onClick={() => setNewKeyResult(null)} style={{ marginTop: 'var(--space-2)' }}>닫기</button>
        </div>
      )}

      {/* 생성 폼 */}
      {showCreate && (
        <div className="card" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
          <h2 className="tape-title" style={{ margin: '0 0 var(--space-3)' }}>새 API Key 생성</h2>
          <label htmlFor="apiKeyName" className="label">API 키 이름</label>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <input
              id="apiKeyName"
              ref={nameInputRef}
              autoFocus
              type="text"
              className="input-field"
              placeholder="API 키 이름을 입력하세요 (예: 운영 서버 연동)"
              value={newKeyName}
              onChange={(e) => { setNewKeyName(e.target.value); if (createError) setCreateError(null) }}
              onKeyDown={(e) => isEnterKey(e) && createKey()}
              style={{ flex: 1, minWidth: '12rem' }}
            />
            <button type="button" className="btn-primary" onClick={createKey} disabled={creating}>
              {creating ? '생성 중...' : '생성'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => { setShowCreate(false); setNewKeyName(''); setCreateError(null) }}>취소</button>
          </div>
          {createError && (
            <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', marginTop: 'var(--space-2)', color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>
              <AlertTriangle size={14} /> {createError}
            </div>
          )}
        </div>
      )}

      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="키 이름 검색"
        filters={FILTERS}
        sortOptions={SORT_OPTIONS}
        total={loading ? undefined : filtered.length}
      />

      <ListSurface
        rows={rows}
        columns={columns}
        query={query}
        rowKey={(k) => k.id}
        onChange={set}
        loading={loading}
        error={loadError ? { message: loadError, onRetry: () => { void fetchKeys() } } : null}
        empty={hasCondition
          ? { title: '조건에 맞는 키가 없어요', description: '검색어나 상태 필터를 바꿔보세요' }
          : { title: 'API Key가 없어요', description: '키를 만들면 외부 시스템에서 GPU 가격 데이터를 가져올 수 있습니다', action: { label: '새 키 생성', onClick: () => setShowCreate(true) } }}
      />

      <ListPager query={query} total={filtered.length} onChange={set} />
    </div>
  )
}
