'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X, RefreshCw, Eye, BookOpenText, Brain, CircleCheck, CircleAlert, CircleX, CircleHelp } from 'lucide-react'
import { useEscClose } from '@/lib/use-esc-close'
import type { AiChatProviderId } from '@/types/database'
import { listModelCatalog, refreshModelCatalog, type ModelCatalogItem } from '@/app/admin/ai-chat/actions'
import { PROVIDER_LABELS } from '@/lib/ai-chat/labels'
import { isSelectableModelAvailability } from '@/lib/ai-chat/model-availability'
import SegmentedTabs from './SegmentedTabs'
import ControlRow from './ControlRow'
import EmptyState from './EmptyState'
import AXDotLoader from './AXDotLoader'

/** 탭에 세울 프로바이더 — 라우트 타입(ProviderView)에 묶이지 않도록 최소 형태만 받는다 */
export interface ModelPickerProvider {
  id: AiChatProviderId
  label?: string
}

interface Props {
  providers: ModelPickerProvider[] // 키가 설정된(가용) 프로바이더만 — 탭 소스. 1개면 탭을 숨긴다
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

const STATUS_META = {
  available: { label: '사용 가능', icon: CircleCheck, color: 'var(--success)' },
  limited: { label: '현재 한도 도달', icon: CircleAlert, color: 'var(--warning)' },
  unavailable: { label: '사용 불가', icon: CircleX, color: 'var(--danger)' },
  unknown: { label: '확인 필요', icon: CircleHelp, color: 'var(--text-faint)' },
} as const

function formatCheckedAt(value: string | null): string {
  if (!value) return '아직 확인하지 않음'
  return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
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
  const probedProviders = useRef(new Set<AiChatProviderId>())

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

  const allForTab = useMemo(() => items.filter((i) => i.provider === tab), [items, tab])
  const itemsForTab = useMemo(
    () => allForTab.filter((i) => isSelectableModelAvailability(i.availability)),
    [allForTab],
  )
  // 선택 가능한 게 0개일 때 "왜"를 보여주기 위한 집계 — 이게 없으면 화면이 "모델이 없습니다"로 거짓말한다.
  const blockedForTab = useMemo(() => {
    const blocked = allForTab.filter((i) => !isSelectableModelAvailability(i.availability))
    const reasons = new Map<string, number>()
    for (const item of blocked) {
      const reason = item.availabilityReason?.trim()
      if (reason) reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
    }
    const topReason = Array.from(reasons.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    return {
      total: blocked.length,
      unavailable: blocked.filter((i) => i.availability === 'unavailable').length,
      limited: blocked.filter((i) => i.availability === 'limited').length,
      topReason,
    }
  }, [allForTab])
  // 지금 쓰고 있는 모델은 가용성과 무관하게 항상 보여준다.
  // 없으면 "내가 뭘 쓰는지"와 "고를 수 있는 것"이 화면에서 끊긴다 — 실제로 메인 모델이
  // unavailable로 판정된 순간 목록에서 사라져, 왜 없는지 알 길이 없었다.
  const currentItem = useMemo(
    () => (currentModel && tab === currentProvider
      ? allForTab.find((i) => i.modelId === currentModel) ?? null
      : null),
    [allForTab, currentModel, currentProvider, tab],
  )
  const currentIsHidden = !!currentItem && !isSelectableModelAvailability(currentItem.availability)

  const pickedItem = items.find((item) => item.provider === tab && item.modelId === picked)
  const canConfirm = !!pickedItem && isSelectableModelAvailability(pickedItem.availability)

  function handleTabChange(id: AiChatProviderId) {
    if (refreshing) return
    setTab(id)
    setPicked(id === currentProvider ? currentModel : null)
  }

  // force=false(탭 자동 진입)는 최근 확인분을 재사용하고, 사용자가 버튼을 누른 경우에만 전량 재확인한다.
  const refreshProvider = useCallback(async (provider: AiChatProviderId, force: boolean) => {
    setRefreshing(true)
    setError(null)
    const r = await refreshModelCatalog(provider, { force })
    if (r.ok) {
      const list = await listModelCatalog()
      if (list.ok && list.items) {
        setItems(list.items)
        setPicked((value) => list.items?.some((item) => item.provider === provider && item.modelId === value) ? value : null)
      } else {
        setError(list.error ?? '새로고친 모델 목록을 불러오지 못했습니다')
      }
    } else {
      setError(r.error ?? '모델 새로고침에 실패했습니다')
    }
    setRefreshing(false)
  }, [])

  useEffect(() => {
    if (!tab || loading || probedProviders.current.has(tab)) return
    probedProviders.current.add(tab)
    void refreshProvider(tab, false)
  }, [loading, refreshProvider, tab])

  function handleRefresh() {
    if (!tab || refreshing) return
    void refreshProvider(tab, true)
  }

  function confirm() {
    if (!tab || !picked) return
    onSelect(tab, picked)
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="모델 선택"
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

        {/* 프로바이더 탭 — 탭 렌더러 SSOT(§2). 새로고침 중에는 전환을 막는다(기존 disabled 동작 유지) */}
        <ControlRow>
          {/* 프로바이더가 1개뿐이면(설정 카드처럼 고정된 경우) 탭은 고를 것이 없으므로 감춘다 */}
          {providers.length > 1 && (
            <SegmentedTabs
              ariaLabel="프로바이더"
              tabs={providers.map((p) => ({ id: p.id, label: p.label ?? PROVIDER_LABELS[p.id] }))}
              activeId={tab ?? undefined}
              onSelect={(id) => { if (!refreshing) handleTabChange(id as AiChatProviderId) }}
            />
          )}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={!tab || refreshing}
            title="모델 새로고침"
            className="btn-ghost"
            style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', cursor: refreshing ? 'wait' : 'pointer' }}
          >
            <RefreshCw size={13} className={refreshing ? 'ai-chat-spin' : undefined} />
            {refreshing ? '새로고침 중…' : '모델 새로고침'}
          </button>
        </ControlRow>

        <div style={{ marginBottom: 'var(--space-3)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          토큰 한도는 한 요청에 담을 수 있는 최대 컨텍스트입니다. 공급자가 계정의 정확한 잔여 쿼터를 제공하지 않아,
          최소 호출로 확인한 현재 가용 상태와 점검 시각을 함께 보여드립니다.
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
          {loading && (
            <div style={{ padding: 'var(--space-3)' }} aria-live="polite" aria-label="모델 목록 불러오는 중">
              <AXDotLoader size={5} color="var(--text-faint)" />
            </div>
          )}
          {!loading && refreshing && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3)', fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }} aria-live="polite">
              <AXDotLoader size={5} color="var(--text-faint)" />
              실제 사용 가능 여부를 확인하는 중
            </div>
          )}
          {!loading && !refreshing && itemsForTab.length === 0 && blockedForTab.total === 0 && (
            <EmptyState
              title="카탈로그에 모델이 없어요"
              description="모델 새로고침으로 최신 목록을 가져오세요"
              action={{ label: '모델 새로고침', onClick: handleRefresh }}
            />
          )}
          {/* 선택 가능한 게 있어도 가려진 것이 있으면 개수를 밝힌다 — 조용히 숨기면
              "내가 아는 모델이 왜 없지?"가 된다(실측: 45개 중 5개만 노출) */}
          {!loading && !refreshing && itemsForTab.length > 0 && blockedForTab.total > 0 && (
            <p style={{ margin: 0, fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)', lineHeight: 1.5 }}>
              지금 쓸 수 없는 모델 {blockedForTab.total}개는 숨겼어요
              (사용 불가 {blockedForTab.unavailable} · 한도 도달 {blockedForTab.limited})
              {blockedForTab.topReason ? ` — ${blockedForTab.topReason}` : ''}
            </p>
          )}

          {/* 지금 쓰는 모델이 숨김 대상이면 맨 위에 그대로 세우고 이유를 보여준다 */}
          {!loading && !refreshing && currentIsHidden && currentItem && (
            <div
              role="alert"
              style={{
                padding: 'var(--space-3) var(--space-4)',
                background: 'var(--warning-bg)', border: 'var(--hairline) solid var(--warning-border)',
                borderRadius: 'var(--radius)', fontSize: 'var(--fs-sm)', color: 'var(--text)', lineHeight: 1.6,
              }}
            >
              <strong style={{ display: 'block', marginBottom: 'var(--space-1)' }}>
                지금 쓰는 모델 {currentItem.label}은(는) 현재 쓸 수 없는 상태입니다
              </strong>
              {currentItem.availabilityReason && (
                <span style={{ display: 'block', color: 'var(--text-muted)' }}>{currentItem.availabilityReason}</span>
              )}
              <span style={{ display: 'block', marginTop: 'var(--space-1)', fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>
                아래에서 쓸 수 있는 모델로 바꾸거나, 결제 상태를 확인한 뒤 모델 새로고침을 눌러 주세요
              </span>
            </div>
          )}

          {!loading && !refreshing && itemsForTab.length === 0 && blockedForTab.total > 0 && (
            <div
              role="alert"
              style={{
                padding: 'var(--space-3) var(--space-4)',
                background: 'var(--warning-bg)', border: 'var(--hairline) solid var(--warning-border)',
                borderRadius: 'var(--radius)', fontSize: 'var(--fs-sm)', color: 'var(--text)', lineHeight: 1.6,
              }}
            >
              <strong style={{ display: 'block', marginBottom: 'var(--space-1)' }}>
                {tab ? PROVIDER_LABELS[tab] : ''} 모델 {blockedForTab.total}개를 찾았지만 지금은 모두 사용할 수 없습니다.
              </strong>
              {blockedForTab.topReason && (
                <span style={{ display: 'block', color: 'var(--text-muted)' }}>{blockedForTab.topReason}</span>
              )}
              <span style={{ display: 'block', marginTop: 'var(--space-1)', fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>
                사용 불가 {blockedForTab.unavailable}개 · 한도 도달 {blockedForTab.limited}개
              </span>
            </div>
          )}
          {!refreshing && itemsForTab.map((m) => {
            const selected = picked === m.modelId
            const blocked = m.availability === 'limited' || m.availability === 'unavailable'
            const status = STATUS_META[m.availability]
            const StatusIcon = status.icon
            return (
              <button
                key={m.modelId}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => { if (!blocked) setPicked(m.modelId) }}
                disabled={blocked}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)',
                  textAlign: 'left', width: '100%',
                  padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius)',
                  border: `var(--border-w) solid ${selected ? 'var(--brand)' : 'var(--border-color)'}`,
                  background: selected ? 'var(--surface-bg)' : 'transparent',
                  cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.68 : 1,
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
                  {m.useCase && (
                    <span style={{ display: 'block', marginTop: 'var(--space-1)', fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                      💡 {m.useCase}
                    </span>
                  )}
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-2)', fontSize: 'var(--fs-2xs)' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: status.color, fontWeight: 700 }}>
                      <StatusIcon size={12} /> {status.label}
                    </span>
                    <span style={{ color: 'var(--text-faint)' }}>점검 {formatCheckedAt(m.availabilityCheckedAt)}</span>
                  </span>
                  {m.availabilityReason && m.availability !== 'available' && (
                    <span style={{ display: 'block', marginTop: 'var(--space-1)', fontSize: 'var(--fs-2xs)', color: status.color }}>
                      {m.availabilityReason}
                    </span>
                  )}
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
            disabled={!canConfirm}
            style={{
              fontSize: 'var(--fs-sm)', fontWeight: 600,
              color: 'var(--accent-fg)', background: 'var(--accent)', border: 'none',
              borderRadius: 'var(--radius)', padding: 'var(--space-2) var(--space-5)',
              cursor: canConfirm ? 'pointer' : 'not-allowed', opacity: canConfirm ? 1 : 0.55,
            }}
          >
            선택
          </button>
        </div>
      </div>
    </div>
  )
}
