'use client'

// 모델 고르기 — 입력칸 안의 작은 드롭다운 (claude.ai 와 같은 자리·같은 크기).
//
// 예전엔 전면 모달이었다. 능력·출시일·상태를 다 보여 주느라 화면을 통째로 덮었는데,
// **대화 중에 모델을 바꾸는 일**은 원래 그런 무게가 아니다. 이름 하나 고르고 바로 이어 쓴다.
// 자세히 볼 일은 화면이 따로 있다(사이드바 「모델」) — 여기 맨 아래 문을 둔다.
//
// 목록은 대화 화면과 같은 창구(listModelCatalog)를 쓴다. 못 쓰는 상태(사용 불가·확인 필요)는
// 감추지 않고 **눌리지 않게** 둔다 — 안 보이면 "왜 사라졌지"가 되고, 보이면 "왜 못 쓰지"가 된다.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react'
import type { AiChatProviderId } from '@/types/database'
import { PROVIDER_LABELS } from '@/lib/ai-chat/labels'
import { isSelectableModelAvailability } from '@/lib/ai-chat/model-availability'
import { MODEL_STATUS_LABEL } from '@/lib/ai-chat/model-status'
import {
  isChatModel,
  modelTier,
  sortModelsForMenu,
  MODEL_TIER_ORDER,
  MODEL_TIER_LABEL,
  MODEL_TIER_HINT,
  type ModelTier,
} from '@/lib/ai-chat/model-tier'
import EmptyState from '@/components/ui/EmptyState'
import AXDotLoader from '@/components/ui/AXDotLoader'
import { listModelCatalog, type ModelCatalogItem } from './actions'
import styles from './model-menu.module.css'

interface Props {
  providers: { id: AiChatProviderId; label?: string }[]
  currentProvider: AiChatProviderId | null
  currentModel: string | null
  disabled?: boolean
  onSelect: (provider: AiChatProviderId, model: string) => void
}

export default function ModelMenu({ providers, currentProvider, currentModel, disabled, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<ModelCatalogItem[] | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // 목록은 **열 때 한 번만** 읽는다. 대화마다 미리 읽으면 안 쓰는 왕복이 매번 생긴다
  useEffect(() => {
    if (!open || items !== null) return
    listModelCatalog().then((r) => setItems(r.ok ? r.items ?? [] : []))
  }, [open, items])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = useCallback((p: AiChatProviderId, m: string) => {
    onSelect(p, m)
    setOpen(false)
  }, [onSelect])

  const label = currentModel ?? (providers.length === 0 ? '키 없음' : '모델')

  /**
   * 성능으로 묶고, 쓸 수 있는 것을 위로 올린다.
   *
   * 공급자로 묶으면 Gemini 28개가 한 덩어리로 쏟아진다 — 고르는 사람이 알고 싶은 것은
   * 「누가 만들었나」가 아니라 「얼마나 잘하나·빠른가」다. 만든 곳은 이름 옆에 작게 붙인다.
   * 지금 못 쓰는 것은 감추지 않고 맨 아래 한 칸으로 모은다(안 보이면 「왜 사라졌지」가 된다).
   */
  const usableIds = new Set(providers.map((p) => p.id))
  const chatModels = (items ?? []).filter((m) => usableIds.has(m.provider) && isChatModel(m))
  const ordered = sortModelsForMenu(
    chatModels.map((m) => ({ ...m, usable: isSelectableModelAvailability(m.availability) })),
  )
  const GROUPS: { key: string; label: string; hint?: string; rows: typeof ordered }[] = [
    ...MODEL_TIER_ORDER.map((t: ModelTier) => ({
      key: t,
      label: MODEL_TIER_LABEL[t],
      hint: MODEL_TIER_HINT[t],
      rows: ordered.filter((m) => m.usable && modelTier(m) === t),
    })),
    { key: 'blocked', label: '지금 쓸 수 없음', rows: ordered.filter((m) => !m.usable) },
  ]

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || providers.length === 0}
        aria-haspopup="menu"
        aria-expanded={open}
        title="모델 고르기"
      >
        <span className={styles.triggerLabel}>{label}</span>
        <ChevronDown size={13} />
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          {items === null && (
            <div className={styles.state}><AXDotLoader /></div>
          )}
          {items?.length === 0 && (
            <div className={styles.state}>
              <EmptyState
                title="고를 수 있는 모델이 없습니다"
                description="사이드바 「모델」에서 새로고침하면 공급자에게 직접 물어봅니다."
              />
            </div>
          )}

          {GROUPS.map((g) => {
            if (g.rows.length === 0) return null
            return (
              <div key={g.key}>
                <div className={styles.group}>
                  {g.label}
                  {g.hint && <span className={styles.groupHint}>{g.hint}</span>}
                </div>
                {g.rows.map((m) => {
                  const usable = isSelectableModelAvailability(m.availability)
                  const chosen = currentProvider === m.provider && currentModel === m.modelId
                  return (
                    <button
                      key={`${m.provider}:${m.modelId}`}
                      type="button"
                      role="menuitemradio"
                      aria-checked={chosen}
                      className={styles.item}
                      disabled={!usable}
                      onClick={() => pick(m.provider, m.modelId)}
                    >
                      <span className={styles.itemBody}>
                        <span className={styles.itemName}>
                          {m.label}
                          <span className={styles.itemMaker}>{PROVIDER_LABELS[m.provider]}</span>
                        </span>
                        <span className={styles.itemDesc}>
                          {usable ? m.useCase : MODEL_STATUS_LABEL[m.availability]}
                        </span>
                      </span>
                      {chosen && <Check size={14} className={styles.check} />}
                    </button>
                  )
                })}
              </div>
            )
          })}

          <div className={styles.divider} />
          <Link href="/ai/models" className={styles.item} onClick={() => setOpen(false)}>
            <span className={styles.itemBody}>
              <span className={styles.itemName}>
                <SlidersHorizontal size={13} /> 모델 전체 보기
              </span>
              <span className={styles.itemDesc}>능력·출시일·막힌 이유까지</span>
            </span>
          </Link>
        </div>
      )}
    </div>
  )
}
