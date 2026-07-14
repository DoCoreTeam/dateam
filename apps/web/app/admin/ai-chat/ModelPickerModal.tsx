'use client'
import { useEffect, useMemo, useState } from 'react'
import { X, RefreshCw, Eye, BookOpenText, Brain } from 'lucide-react'
import { useEscClose } from '@/lib/use-esc-close'
import type { AiChatProviderId } from '@/types/database'
import { listModelCatalog, refreshModelCatalog, type ModelCatalogItem } from './actions'
import type { ProviderView } from './AiChatClient'
import { PROVIDER_LABELS } from '@/lib/ai-chat/labels'

interface Props {
  providers: ProviderView[] // 키가 설정된(가용) 프로바이더만 — 탭 소스
  currentProvider: AiChatProviderId | null
  currentModel: string | null
  onSelect: (provider: AiChatProviderId, model: string) => void
  onClose: () => void
}

function formatReleased(d: string | null): string {
  if (!d) return ''
  const [y, m] = d.split('-')
  return `${y}.${m}`
}

// 모델 선택 모달(⑤) — DB 카탈로그(능력·출시일)에서 선택 + "모델 새로고침"으로 실 프로바이더 목록 반영.
// 표준: useEscClose·tape-title·boxShadow(--shadow-modal)·backdrop(--modal-backdrop).
export default function ModelPickerModal({ providers, currentProvider, currentModel, onSelect, onClose }: Props) {
  useEscClose(onClose)
  const [tab, setTab] = useState<AiChatProviderId | null>(currentProvider ?? providers[0]?.id ?? null)
  const [items, setItems] = useState<ModelCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(currentModel ?? null)

  useEffect(() => {
    let alive = true
    listModelCatalog().then((r) => {
      if (!alive) return
      if (r.ok && r.items) setItems(r.items)
      else setError(r.error ?? '모델 카탈로그 조회에 실패했습니다')
      setLoading(false)
    })
    return () => { alive = false }
  }, [])

  const itemsForTab = useMemo(() => items.filter((i) => i.provider === tab), [items, tab])

  function handleTabChange(id: AiChatProviderId) {
    setTab(id)
    setPicked(id === currentProvider ? currentModel : null)
  }

  async function handleRefresh() {
    if (!tab || refreshing) return
    setRefreshing(true)
    setError(null)
    const r = await refreshModelCatalog(tab)
    if (r.ok) {
      const list = await listModelCatalog()
      if (list.ok && list.items) setItems(list.items)
    } else {
      setError(r.error ?? '모델 새로고침에 실패했습니다')
    }
    setRefreshing(false)
  }

  function confirm() {
    if (!tab || !picked) return
    onSelect(tab, picked)
    onClose()
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 'var(--z-modal)',
        background: 'var(--modal-backdrop)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)',
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: 560,
          background: 'var(--color-surface)', borderRadius: 'var(--radius)',
          padding: 'var(--space-6)', boxShadow: 'var(--shadow-modal)',
          maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <h3 className="tape-title" style={{ margin: 0 }}>모델 선택</h3>
          <button
            onClick={onClose}
            aria-label="닫기"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)' }}
          >
            <X size={18} />
          </button>
        </div>

        <div role="tablist" aria-label="프로바이더" style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={tab === p.id}
              onClick={() => handleTabChange(p.id)}
              style={{
                padding: 'var(--space-1) var(--space-3)',
                borderRadius: 'var(--radius)',
                border: `var(--border-w) solid ${tab === p.id ? 'var(--brand)' : 'var(--border-color)'}`,
                background: tab === p.id ? 'var(--brand)' : 'transparent',
                color: tab === p.id ? 'var(--accent-fg)' : 'var(--text-muted)',
                fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'pointer',
              }}
            >
              {PROVIDER_LABELS[p.id]}
            </button>
          ))}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={!tab || refreshing}
            title="모델 새로고침"
            style={{
              marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)',
              padding: 'var(--space-1) var(--space-3)', borderRadius: 'var(--radius)',
              border: 'var(--border-w) solid var(--border-color)', background: 'transparent',
              color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', cursor: refreshing ? 'wait' : 'pointer',
            }}
          >
            <RefreshCw size={13} className={refreshing ? 'ai-chat-spin' : undefined} />
            {refreshing ? '새로고침 중…' : '모델 새로고침'}
          </button>
        </div>

        {error && (
          <div
            role="alert"
            style={{
              marginBottom: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)',
              background: 'var(--danger-bg)', border: 'var(--hairline) solid var(--danger-border)',
              borderRadius: 'var(--radius)', fontSize: 'var(--fs-sm)', color: 'var(--danger)',
            }}
          >
            {error}
          </div>
        )}

        <div role="radiogroup" aria-label="모델 목록" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxHeight: 360, overflowY: 'auto' }}>
          {loading && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)', padding: 'var(--space-3)' }}>불러오는 중…</div>}
          {!loading && itemsForTab.length === 0 && (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)', padding: 'var(--space-3)' }}>
              카탈로그에 모델이 없습니다. &quot;모델 새로고침&quot;으로 최신 목록을 가져오세요.
            </div>
          )}
          {itemsForTab.map((m) => {
            const selected = picked === m.modelId
            return (
              <button
                key={m.modelId}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setPicked(m.modelId)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)',
                  textAlign: 'left', width: '100%',
                  padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius)',
                  border: `var(--border-w) solid ${selected ? 'var(--brand)' : 'var(--border-color)'}`,
                  background: selected ? 'var(--surface-bg)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)' }}>
                    {m.label}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-1)', fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>
                    {m.capabilities.vision && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><Eye size={11} /> vision</span>
                    )}
                    {m.capabilities.longContext && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><BookOpenText size={11} /> long-context</span>
                    )}
                    {m.capabilities.reasoning && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><Brain size={11} /> reasoning</span>
                    )}
                    {m.contextLength && <span>{m.contextLength.toLocaleString()} tok</span>}
                    {m.releasedAt && <span>출시 {formatReleased(m.releasedAt)}</span>}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  style={{
                    flexShrink: 0, width: 16, height: 16, borderRadius: '50%',
                    border: `var(--border-w-2) solid ${selected ? 'var(--brand)' : 'var(--border-color)'}`,
                    background: selected ? 'var(--brand)' : 'transparent',
                  }}
                />
              </button>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-5)', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            취소
          </button>
          <button
            onClick={confirm}
            disabled={!picked}
            style={{
              fontSize: 'var(--fs-sm)', fontWeight: 600,
              color: 'var(--accent-fg)', background: 'var(--accent)', border: 'none',
              borderRadius: 'var(--radius)', padding: 'var(--space-2) var(--space-5)',
              cursor: picked ? 'pointer' : 'not-allowed',
            }}
          >
            선택
          </button>
        </div>
      </div>
    </div>
  )
}
