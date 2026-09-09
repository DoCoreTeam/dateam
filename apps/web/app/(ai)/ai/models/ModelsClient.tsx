'use client'

// 모델 화면 — 공급자별 모델 목록과 지금 상태.
//
// 데이터는 모델 선택 모달과 **같은 창구**(listModelCatalog / refreshModelCatalog)를 쓴다.
// 두 벌로 읽으면 모달에선 살아 있고 이 화면에선 막혀 있는 식으로 갈린다.

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, CircleCheck, CircleAlert, CircleX, CircleHelp } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import EmptyState from '@/components/ui/EmptyState'
import AXDotLoader from '@/components/ui/AXDotLoader'
import { PROVIDER_LABELS } from '@/lib/ai-chat/labels'
import { MODEL_STATUS_LABEL, MODEL_STATUS_COLOR, MODEL_CAP_LABEL } from '@/lib/ai-chat/model-status'
import { withSubmitGuard } from '@/lib/forms/submit-guard'
import type { AiChatProviderId } from '@/types/database'
import { listModelCatalog, refreshModelCatalog, type ModelCatalogItem } from '../actions'
import styles from './models.module.css'

interface ProviderView {
  id: AiChatProviderId
  label: string
  model: string
}

interface Props {
  providers: ProviderView[]
  defaultProvider: { id: AiChatProviderId; model: string } | null
}

/** 말과 색은 lib 의 표에서 온다 — 그림만 화면이 고른다 */
const STATUS_ICON = {
  available: CircleCheck,
  limited: CircleAlert,
  unavailable: CircleX,
  unknown: CircleHelp,
} as const

function formatReleased(d: string | null): string {
  if (!d) return ''
  const [y, m] = d.split('-')
  return `${y}.${m} 출시`
}

function formatContext(n: number | null): string {
  if (!n) return ''
  return `컨텍스트 ${Math.round(n / 1000).toLocaleString('ko-KR')}k`
}

export default function ModelsClient({ providers, defaultProvider }: Props) {
  const [items, setItems] = useState<ModelCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState<AiChatProviderId | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    listModelCatalog().then((r) => {
      if (r.ok) {
        setItems(r.items ?? [])
        setError(null)
      } else {
        setError(r.error ?? '모델 목록을 불러오지 못했습니다')
      }
      setLoading(false)
    })
  }, [])

  useEffect(load, [load])

  // 공급자에게 직접 물어보는 호출이라 늦거나 안 올 수 있다.
  // 진행 표시를 켜 놓고 끝을 보장하지 않으면 화면이 「확인 중」에 영원히 갇힌다.
  const refresh = useCallback(
    (provider: AiChatProviderId) =>
      withSubmitGuard(
        async () => {
          setRefreshing(provider)
          const r = await refreshModelCatalog(provider, { force: true })
          if (!r.ok) {
            setError(r.error ?? '모델 새로고침에 실패했습니다')
            return
          }
          setError(null)
          load()
        },
        {
          onError: (message) => setError(message),
          onDone: () => setRefreshing(null),
        },
      ),
    [load],
  )

  if (loading) return <AXDotLoader />

  if (providers.length === 0) {
    return (
      <EmptyState
        title="설정된 AI 키가 없습니다"
        description="API Keys 화면에서 공급자 키를 먼저 등록하면 여기에 모델이 나타납니다."
      />
    )
  }

  return (
    <div className={styles.stack}>
      {error && <p className={styles.headNote}>{error}</p>}

      {providers.map((p) => {
        const rows = items.filter((it) => it.provider === p.id)
        const isDefault = defaultProvider?.id === p.id
        return (
          <section key={p.id} className="card">
            <div className={styles.head}>
              <h2 className={styles.headTitle}>{PROVIDER_LABELS[p.id] ?? p.label}</h2>
              {isDefault && <span className={styles.chosen}>기본 공급자</span>}
              <span className={styles.headSpacer} />
              <span className={styles.headNote}>{rows.length}개</span>
              <NbButton
                variant="ghost"
                onClick={() => refresh(p.id)}
                disabled={refreshing !== null}
              >
                <RefreshCw size={14} />
                {refreshing === p.id ? '확인 중' : '새로고침'}
              </NbButton>
            </div>

            {rows.length === 0 ? (
              <EmptyState
                title="아직 확인한 모델이 없습니다"
                description="새로고침을 누르면 공급자에게 직접 목록을 물어봅니다."
              />
            ) : (
              <div className={styles.rows}>
                {rows.map((m) => {
                  const Icon = STATUS_ICON[m.availability] ?? STATUS_ICON.unknown
                  const caps = Object.entries(m.capabilities)
                    .filter(([, on]) => on === true)
                    .map(([k]) => MODEL_CAP_LABEL[k])
                    .filter(Boolean)
                  const chosen = defaultProvider?.id === p.id && defaultProvider.model === m.modelId
                  return (
                    <div key={m.modelId} className={styles.row}>
                      <div>
                        <span className={styles.name}>{m.label}</span>
                        {chosen && <span className={styles.chosen}> 기본 모델</span>}
                        <div className={styles.id}>{m.modelId}</div>
                      </div>
                      <span className={styles.status} style={{ color: MODEL_STATUS_COLOR[m.availability] }}>
                        <Icon size={14} />
                        {MODEL_STATUS_LABEL[m.availability]}
                      </span>
                      {m.useCase && <p className={styles.use}>{m.useCase}</p>}
                      <div className={styles.meta}>
                        {caps.map((c) => (
                          <span key={c} className={styles.cap}>
                            {c}
                          </span>
                        ))}
                        {formatContext(m.contextLength) && <span>{formatContext(m.contextLength)}</span>}
                        {formatReleased(m.releasedAt) && <span>{formatReleased(m.releasedAt)}</span>}
                        {m.availabilityReason && <span>{m.availabilityReason}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
