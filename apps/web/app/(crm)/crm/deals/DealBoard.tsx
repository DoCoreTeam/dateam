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
import { readApiError, describeFetchFailure } from '@/lib/crm/api/read-error'
import Sensitive from '@/components/crm/Sensitive'
import Link from 'next/link'
import { AlertTriangle, Clock, CheckCircle2, X } from 'lucide-react'
import { Plus } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import DealCloseModal from './DealCloseModal'
import { formatAmount } from './amount'
import styles from './board.module.css'

/** 옮긴 딜을 AI 가 본 결과 — 서버(stage-review.v1)의 출력 그대로다 */
export interface StageReview {
  dealName: string
  verdict: 'ready' | 'check' | 'not_ready'
  headline: string
  findings: { what: string; because: string }[]
  suggestion: string | null
}

export interface BoardStage {
  id: string
  name: string
  position: number
  kind: 'OPEN' | 'WON' | 'LOST'
  /** 이 단계에 있는 딜 수 — API 는 주고 있었는데 타입에만 없었다 */
  dealCount?: number
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
  /**
   * 다음에 할 일.
   *
   * **이게 없으면 보드는 정적인 목록이다.** Pipedrive 의 원칙 —
   * "모든 열린 딜에는 다음 활동이 계획되어 있어야 한다".
   * 없는 딜은 카드에 경고가 뜬다.
   */
  nextAction?: {
    state: 'overdue' | 'today' | 'planned' | 'undated' | 'none'
    title: string | null
    hint: string
  } | null
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
  /** 옮기긴 했는데 비어 있는 것 — 오류가 아니라 알림이다 */
  const [moveNotice, setMoveNotice] = useState<string | null>(null)
  /**
   * 옮긴 뒤 AI 가 본 결과.
   *
   * 이동과 **따로** 부른다. 같이 부르면 AI 가 느린 날 드래그가 느려지고,
   * AI 가 죽는 날 이동이 죽는다. 조언은 늦게 와도 되지만 저장은 그럴 수 없다.
   */
  const [review, setReview] = useState<StageReview | null>(null)
  const [reviewing, setReviewing] = useState(false)
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
      if (!openRes.ok) { setError(readApiError(openBody, '딜을 불러오지 못했습니다.')); return }
      const all: BoardDeal[] = allRows(allBody, openBody)
      setDeals(all)
    } catch {
      setError(describeFetchFailure('딜'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadDeals(pipelineId) }, [pipelineId, loadDeals, reloadKey])

  const pipeline = pipelines.find((p) => p.id === pipelineId)

  /**
   * 옮긴 딜을 AI 가 본다.
   *
   * **실패해도 아무 말도 하지 않는다.** 이동은 이미 성공했다 —
   * 여기서 오류를 띄우면 사람은 저장이 실패한 줄 안다.
   * 걸리는 게 없을 때(ready)도 조용히 넘어간다. 매번 "괜찮습니다"가 뜨면 그때부터 안 읽는다.
   */
  async function askReview(deal: BoardDeal) {
    setReviewing(true)
    try {
      const res = await fetch(`/api/crm/deals/${deal.id}/stage-review`, { method: 'POST' })
      if (!res.ok) return
      const body = await res.json()
      const r = body?.review
      if (!r || r.verdict === 'ready') return
      setReview({ ...r, dealName: deal.name })
    } catch {
      // 조언은 없어도 된다 — 이동은 이미 끝났다
    } finally {
      setReviewing(false)
    }
  }

  async function move(deal: BoardDeal, stage: BoardStage) {
    if (deal.stageId === stage.id) return
    // 성사·실주는 필요한 값을 먼저 묻는다 — 서버 오류로 알게 하지 않는다
    if (stage.kind === 'WON' || stage.kind === 'LOST') {
      setClosing({ deal, stage })
      return
    }
    setMoveError(null)
    setMoveNotice(null)
    setReview(null)
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
      /**
       * 막지는 않았지만 비어 있는 것 — 사람이 알아야 한다.
       * 응답에 실어 놓고 화면이 안 보여 주면 조건을 켠 적 없는 것과 같다.
       */
      const warn = (body.entryWarnings ?? []) as { message: string }[]
      setMoveNotice(warn.length > 0
        ? `옮겼어요. 다만 ${warn.map((w) => w.message).join(', ')}.`
        : null)
      // 저장은 끝났다. 이제 AI 에게 "이 딜, 여기 있어도 되나"를 묻는다
      void askReview(deal)
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
            {/*
              쓰는 것만 먼저. 딜 0건인 파이프라인이 목록을 채우면
              **고를 때마다 빈 보드**를 만나게 된다. 지금 보고 있는 것은 항상 남긴다.
            */}
            {pipelines
              .filter((p) => p.id === pipelineId || p.stages.some((s) => (s.dealCount ?? 0) > 0))
              .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}

            {/* 접은 것을 숨기지 않는다 — 몇 개가 있는지는 말한다 */}
            {(() => {
              const hidden = pipelines.filter(
                (p) => p.id !== pipelineId && !p.stages.some((s) => (s.dealCount ?? 0) > 0))
              return hidden.length === 0 ? null : (
                <optgroup label={`아직 안 쓰는 것 ${hidden.length}개`}>
                  {hidden.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </optgroup>
              )
            })()}
          </select>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <NbButton onClick={onCreate}><Plus size={16} /> 딜 추가</NbButton>
        </div>
      </div>

      <FormErrorBanner message={moveError} />
      {moveNotice && <p className={styles.moveNotice}>{moveNotice}</p>}

      {reviewing && !review && <p className={styles.reviewPending}>AI가 이 딜을 보는 중…</p>}

      {/*
        AI 검토 — 진입 조건표가 하던 일을 대신한다.
        조건표는 "칸이 비었나"를 물었고 아무도 켜지 않았다. 이건 "넘어가도 되나"를 묻는다.
        닫을 수 있어야 한다 — 못 닫으면 다음 이동까지 남아 방해가 된다.
      */}
      {review && (
        <div
          className={`${styles.review} ${review.verdict === 'not_ready' ? styles.reviewStop : styles.reviewCheck}`}
          role="status"
        >
          <div className={styles.reviewHead}>
            <AlertTriangle size={14} />
            <strong>{review.headline}</strong>
            <span className={styles.reviewDeal}>{review.dealName}</span>
            <button
              type="button" className={styles.reviewClose}
              aria-label="검토 닫기" onClick={() => setReview(null)}
            >
              <X size={14} />
            </button>
          </div>
          {review.findings.length > 0 && (
            <ul className={styles.reviewList}>
              {review.findings.map((f, i) => (
                <li key={i}>
                  {f.what}
                  {/* 근거를 같이 보여 준다 — 근거 없는 지적은 잔소리다 */}
                  <span className={styles.reviewBecause}> — {f.because}</span>
                </li>
              ))}
            </ul>
          )}
          {review.suggestion && <p className={styles.reviewNext}>👉 {review.suggestion}</p>}
        </div>
      )}

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
                        {amount ? <span className={styles.amount}><Sensitive>{amount}</Sensitive></span> : <span>금액 미정</span>}
                      </div>

                      {/*
                        다음에 뭘 할지 — 카드에서 바로 보여야 한다.
                        눌러 들어가야 보이면 사람은 안 본다(그래서 예전 보드가 정적인 목록이었다).
                      */}
                      <div className={styles.nextAction} data-state={d.nextAction?.state ?? 'none'}>
                        {(!d.nextAction || d.nextAction.state === 'none') ? (
                          <>
                            <AlertTriangle size={12} aria-hidden />
                            <span>다음에 뭘 할지 정해 주세요</span>
                          </>
                        ) : (
                          <>
                            {d.nextAction.state === 'overdue'
                              ? <AlertTriangle size={12} aria-hidden />
                              : d.nextAction.state === 'today'
                                ? <Clock size={12} aria-hidden />
                                : <CheckCircle2 size={12} aria-hidden />}
                            <span className={styles.nextTitle}>{d.nextAction.title}</span>
                            <span className={styles.nextHint}>{d.nextAction.hint}</span>
                          </>
                        )}
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
