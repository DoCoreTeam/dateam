'use client'

// 딜 보드 (dacrm T1-03)
//
// 단계를 옮기는 길이 **둘**이다. 드래그만 두면 못 옮기는 사람이 생긴다:
//   · HTML5 드래그는 터치 기기에서 동작하지 않는다 — 휴대폰에서는 딜을 영영 못 옮긴다
//   · 키보드만 쓰는 사람도 못 옮긴다
//   · 자동화로 검증할 수 없다(합성 이벤트로는 안 걸린다 — 실측으로 확인했다)
// 그래서 카드마다 단계 선택을 함께 둔다. 드래그는 마우스 사용자의 빠른 길이고,
// 선택은 **모두의 확실한 길**이다.
// 어느 쪽으로 옮기든 서버가 딜과 이력을 한 트랜잭션으로 바꾼다(DI-09).
//
// 성사·실주 칸에 놓으면 바로 넣지 않고 모달을 띄운다:
//   WON 은 금액과 성사일 없이 존재할 수 없고(DI-06), LOST 는 사유 없이 존재할 수 없다(DI-07).
//   화면이 먼저 물어보지 않으면 사용자는 서버 오류를 보고서야 무엇이 필요한지 안다.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import DealCloseModal from './DealCloseModal'
import { formatAmount } from './amount'
import styles from './board.module.css'

export interface BoardStage {
  id: string
  name: string
  position: number
  kind: 'OPEN' | 'WON' | 'LOST'
}
export interface BoardPipeline {
  id: string
  name: string
  isDefault: boolean
  stages: BoardStage[]
}
export interface BoardDeal {
  id: string
  name: string
  stageId: string
  status: string
  amountMinor: string | null
  currency: string | null
  version: number
}

interface Props {
  pipelines: BoardPipeline[]
  pipelineId: string
  onPipelineChange: (id: string) => void
  onCreate: () => void
  /** 목록을 다시 읽어야 할 때 바뀌는 값(저장 직후 등) */
  reloadKey: number
}

export default function DealBoard({ pipelines, pipelineId, onPipelineChange, onCreate, reloadKey }: Props) {
  const [deals, setDeals] = useState<BoardDeal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overStage, setOverStage] = useState<string | null>(null)
  const [closing, setClosing] = useState<{ deal: BoardDeal; stage: BoardStage } | null>(null)

  const loadDeals = useCallback(async (pid: string) => {
    if (!pid) return
    setLoading(true)
    setError(null)
    try {
      // 보드는 열린 딜만 본다 — 닫힌 딜까지 쌓으면 지금 할 일이 안 보인다.
      // 성사·실주 칸은 "방금 닫힌 것"을 보여 주려고 따로 가져온다.
      const [openRes, closedRes] = await Promise.all([
        fetch(`/api/crm/deals?pipelineId=${pid}&status=OPEN&limit=100`),
        fetch(`/api/crm/deals?pipelineId=${pid}&limit=100`),
      ])
      const openBody = await openRes.json()
      const allBody = await closedRes.json()
      if (!openRes.ok) { setError(openBody?.error?.message ?? '딜을 불러오지 못했습니다.'); return }
      const all: BoardDeal[] = allRows(allBody, openBody)
      setDeals(all)
    } catch {
      setError('딜을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadDeals(pipelineId) }, [pipelineId, loadDeals, reloadKey])

  const pipeline = pipelines.find((p) => p.id === pipelineId)

  async function move(deal: BoardDeal, stage: BoardStage) {
    if (deal.stageId === stage.id) return
    // 성사·실주는 필요한 값을 먼저 묻는다 — 서버 오류로 알게 하지 않는다
    if (stage.kind === 'WON' || stage.kind === 'LOST') {
      setClosing({ deal, stage })
      return
    }
    setMoveError(null)
    // 낙관적으로 먼저 옮겨 보여 준다 — 실패하면 되돌린다
    const prev = deals
    setDeals((rows) => rows.map((r) => (r.id === deal.id ? { ...r, stageId: stage.id } : r)))
    try {
      const res = await fetch(`/api/crm/deals/${deal.id}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: deal.version, toStageId: stage.id }),
      })
      const body = await res.json()
      if (!res.ok) {
        setDeals(prev)
        setMoveError(body?.error?.message ?? '단계를 옮기지 못했습니다.')
        return
      }
      setDeals((rows) => rows.map((r) => (r.id === deal.id ? { ...r, ...body } : r)))
    } catch {
      setDeals(prev)
      setMoveError('단계를 옮기지 못했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }

  if (error && deals.length === 0) {
    return <ErrorState message={error} onRetry={() => void loadDeals(pipelineId)} />
  }
  if (loading && deals.length === 0) return <AXDotLoader />
  if (!pipeline) {
    return (
      <EmptyState
        title="파이프라인이 아직 없어요"
        description="설정에서 파이프라인을 만들면 여기에 단계가 나타납니다."
        action={{ label: '설정 열기', href: '/crm/settings' }}
      />
    )
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end', marginBottom: 'var(--space-4)' }}>
        <div>
          <label className="label" htmlFor="crm-board-pipeline">파이프라인</label>
          <select
            id="crm-board-pipeline"
            className="input-field"
            value={pipelineId}
            onChange={(e) => onPipelineChange(e.target.value)}
            style={{ minWidth: 200 }}
          >
            {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <NbButton onClick={onCreate}><Plus size={16} /> 딜 추가</NbButton>
        </div>
      </div>

      <FormErrorBanner message={moveError} />

      <div className={styles.board}>
        {pipeline.stages.map((stage) => {
          const rows = deals.filter((d) => d.stageId === stage.id)
          const kindClass = stage.kind === 'WON' ? styles.kindWon : stage.kind === 'LOST' ? styles.kindLost : ''
          return (
            <div
              key={stage.id}
              className={`${styles.column}${overStage === stage.id ? ` ${styles.columnOver}` : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOverStage(stage.id) }}
              onDragLeave={() => setOverStage((s) => (s === stage.id ? null : s))}
              onDrop={(e) => {
                e.preventDefault()
                setOverStage(null)
                const deal = deals.find((d) => d.id === dragId)
                if (deal) void move(deal, stage)
                setDragId(null)
              }}
            >
              <div className={styles.columnHead}>
                <span className={kindClass}>{stage.name}</span>
                <span className={styles.count}>{rows.length}</span>
              </div>

              {rows.length === 0 ? (
                <div className={styles.emptyColumn}>비어 있음</div>
              ) : rows.map((d) => {
                const amount = formatAmount(d.amountMinor, d.currency)
                return (
                  <div
                    key={d.id}
                    className={`${styles.card}${dragId === d.id ? ` ${styles.cardDragging}` : ''}`}
                    draggable
                    onDragStart={() => setDragId(d.id)}
                    onDragEnd={() => { setDragId(null); setOverStage(null) }}
                  >
                    <Link href={`/crm/deals/${d.id}`} className={styles.cardLink}>
                      <div className={styles.cardName}>{d.name}</div>
                      <div className={styles.cardMeta}>
                        {amount ? <span className={styles.amount}>{amount}</span> : <span>금액 미정</span>}
                      </div>
                    </Link>

                    {/* 드래그를 못 하는 사람의 길. 카드를 여는 클릭과 섞이지 않게 전파를 멈춘다 */}
                    <select
                      className={`input-field ${styles.moveSelect}`}
                      aria-label={`${d.name} 단계 이동`}
                      value={d.stageId}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const next = pipeline.stages.find((st) => st.id === e.target.value)
                        if (next) void move(d, next)
                      }}
                    >
                      {pipeline.stages.map((st) => (
                        <option key={st.id} value={st.id}>{st.name}</option>
                      ))}
                    </select>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {closing && (
        <DealCloseModal
          deal={closing.deal}
          stage={closing.stage}
          onClose={() => setClosing(null)}
          onDone={() => { setClosing(null); void loadDeals(pipelineId) }}
        />
      )}
    </>
  )
}

/** 열린 딜 + 방금 닫힌 딜을 합친다(중복 없이) */
function allRows(
  allBody: { items?: BoardDeal[] },
  openBody: { items?: BoardDeal[] },
): BoardDeal[] {
  const map = new Map<string, BoardDeal>()
  for (const d of openBody.items ?? []) map.set(d.id, d)
  for (const d of allBody.items ?? []) if (!map.has(d.id)) map.set(d.id, d)
  return Array.from(map.values())
}
