'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ApiResponse } from '@/lib/ci/contracts'
import { RowSkeleton, ErrorState } from '@/components/ci/states'

interface SettingItem {
  key: string
  scope: 'system' | 'workspace' | 'user'
  group: string
  label: string
  help: string
  value: unknown
  defaultValue: unknown
  origin: string
  isSecret: boolean
  destructive: boolean
  version: number
  kind: 'boolean' | 'number' | 'list' | 'json' | 'text'
}

const GROUP_LABEL: Record<string, string> = {
  account: '내 계정',
  workspace: '워크스페이스',
  alert: '알림',
  data: '데이터와 수집',
  topic: '주제',
  analysis: '분석 기준',
  ai: 'AI',
  publish: '게시 기본값',
  system: '운영자',
}

const ORIGIN_LABEL: Record<string, string> = {
  user: '내 설정',
  workspace: '워크스페이스 설정',
  system: '시스템 설정',
  default: '기본값',
}

export default function SettingsView({ workspaceId }: { workspaceId: string }) {
  const [items, setItems] = useState<SettingItem[] | null>(null)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [query, setQuery] = useState('')
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/ci/settings', { headers: { 'X-CI-Workspace': workspaceId } })
        .then((r) => r.json() as Promise<ApiResponse<{ items: SettingItem[]; encryptionAvailable: boolean }>>)
      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }
      setItems(res.data.items)
    } catch {
      setError({ code: 'INTERNAL', message: '설정을 불러오지 못했습니다' })
    }
  }, [workspaceId])

  useEffect(() => { load() }, [load])

  async function save(item: SettingItem, raw: string | boolean) {
    setSavingKey(item.key); setError(null)
    let value: unknown = raw
    if (item.kind === 'number') value = Number(raw)
    if (item.kind === 'list' || item.kind === 'json') {
      try { value = JSON.parse(String(raw)) }
      catch { setError({ code: 'VALIDATION_FAILED', message: '형식이 올바르지 않습니다 (JSON)' }); setSavingKey(null); return }
    }
    try {
      const res = await fetch('/api/ci/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({ key: item.key, scope: item.scope, value, version: item.version || undefined }),
      }).then((r) => r.json() as Promise<ApiResponse<unknown>>)
      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }
      setToast(`${item.label} 저장했습니다`)
      setTimeout(() => setToast(null), 2500)
      await load()
    } finally { setSavingKey(null) }
  }

  async function revert(item: SettingItem) {
    setSavingKey(item.key)
    try {
      await fetch(`/api/ci/settings?key=${encodeURIComponent(item.key)}&scope=${item.scope}`, {
        method: 'DELETE', headers: { 'X-CI-Workspace': workspaceId },
      })
      await load()
    } finally { setSavingKey(null) }
  }

  const groups = useMemo(() => {
    if (!items) return []
    const q = query.trim().toLowerCase()
    const filtered = q
      ? items.filter((i) => i.label.toLowerCase().includes(q) || i.help.toLowerCase().includes(q) || i.key.includes(q))
      : items
    const map = new Map<string, SettingItem[]>()
    for (const i of filtered) {
      const list = map.get(i.group) ?? []
      list.push(i)
      map.set(i.group, list)
    }
    return Array.from(map.entries())
  }, [items, query])

  return (
    <>
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <label className="label" htmlFor="ci-set-search">설정 검색</label>
        <input className="input-field" id="ci-set-search" value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="설정 이름이나 설명으로 찾기" />
      </div>

      {toast && (
        <p className="ci-status ci-status-ok" style={{ marginBottom: 'var(--space-3)', display: 'inline-flex' }}>
          {toast}
        </p>
      )}
      {error && <div style={{ marginBottom: 'var(--space-4)' }}><ErrorState code={error.code} message={error.message} onRetry={load} /></div>}

      {!items ? <RowSkeleton rows={6} /> : groups.length === 0 ? (
        <p className="ci-empty-desc">검색과 일치하는 설정이 없습니다.</p>
      ) : (
        groups.map(([group, list]) => (
          <section key={group} style={{ marginBottom: 'var(--space-8)' }}>
            <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--space-3)' }}>
              {GROUP_LABEL[group] ?? group}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {(list as SettingItem[]).map((item) => (
                <div key={item.key} style={{
                  padding: 'var(--space-3)', border: 'var(--border-w-2) solid var(--border-color)',
                  borderRadius: 'var(--radius)', background: 'var(--color-surface)',
                }}>
                  <label className="label" htmlFor={`s-${item.key}`}>{item.label}</label>
                  <p className="ci-basis" style={{ marginBottom: 'var(--space-2)' }}>{item.help}</p>

                  {item.isSecret ? (
                    <p className="ci-status ci-status-neutral">저장된 값은 보여드리지 않습니다</p>
                  ) : item.kind === 'boolean' ? (
                    <button type="button" className="btn-ghost"
                      onClick={() => save(item, !(item.value as boolean))}
                      disabled={savingKey === item.key}>
                      {item.value ? '켜짐 — 끄기' : '꺼짐 — 켜기'}
                    </button>
                  ) : (
                    <input className="input-field" id={`s-${item.key}`}
                      defaultValue={typeof item.value === 'object'
                        ? JSON.stringify(item.value)
                        : String(item.value ?? '')}
                      onBlur={(e) => {
                        const next = e.target.value
                        const cur = typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value ?? '')
                        if (next !== cur) save(item, next)
                      }}
                      disabled={savingKey === item.key}
                    />
                  )}

                  <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginTop: 'var(--space-2)' }}>
                    <span className="ci-basis">적용 중: {ORIGIN_LABEL[item.origin] ?? item.origin}</span>
                    {item.origin !== 'default' && (
                      <button type="button" className="ci-metric" onClick={() => revert(item)}
                        disabled={savingKey === item.key}>
                        기본값으로 되돌리기
                      </button>
                    )}
                    {item.destructive && <span className="ci-status ci-status-warn">되돌리기 어려운 설정</span>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </>
  )
}
