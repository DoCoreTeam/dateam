'use client'

// components/ci/QueueProgressPanel.tsx — 큐 진행 상황 패널
//
// 왜 있나: "수집 중 1,017건 남음" 칩이 숫자만 말하고 눌리지도 않았다.
// 사용자는 **무엇을 하는 중이고 언제 끝나는지**를 알고 싶어 눌러 봤다(지적 2026-08-18).
//
// 여기서 지키는 것 하나: **모르는 것은 모른다고 말한다.**
// 표본이 적으면 남은 시간을 내지 않는다(lib/ci/jobs/progress.ts). 한 번 틀린 예상은
// 그 뒤로 아무도 안 믿게 만든다 — 없는 숫자보다 나쁜 것이 틀린 숫자다.

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import SlidePanel from '@/components/ui/SlidePanel'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import { SkelList } from '@/components/ui/LoadingSkeleton'
import type { ApiResponse } from '@/lib/ci/contracts'
import s from './queue-progress-panel.module.css'

interface StageProgress {
  stage: string
  label: string
  note: string
  waiting: number
  running: number
  failed: number
  share: number
}

interface RecentFailure {
  stage: string
  stageLabel: string
  message: string
  count: number
  status: string
}

export interface QueueProgress {
  waiting: number
  running: number
  failed: number
  dead: number
  pending: number
  stages: StageProgress[]
  recentFailures: RecentFailure[]
  perMinute: number | null
  etaMinutes: number | null
  /** 남은 시간 문구. 서버가 만든다 — 화면마다 다른 말이 나오지 않게 */
  etaText: string | null
}

interface Props {
  isOpen: boolean
  onClose: () => void
  workspaceId: string
}

/** 열려 있는 동안만 이 간격으로 다시 묻는다. 닫히면 묻지 않는다. */
const REFRESH_MS = 5_000

export default function QueueProgressPanel({ isOpen, onClose, workspaceId }: Props) {
  const [data, setData] = useState<QueueProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/ci/queue/progress?workspaceId=${workspaceId}`, {
        headers: { 'X-CI-Workspace': workspaceId },
      }).then((r) => r.json() as Promise<ApiResponse<QueueProgress>>)
      if (!res.success) { setError(res.error.message); return }
      setData(res.data)
      setError(null)
    } catch {
      setError('진행 상황을 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    if (!isOpen) return
    void load()
    // 닫으면 멈춘다 — 배경에서 조용히 서버를 때리지 않는다(QueueDriver와 같은 규칙)
    const t = setInterval(() => { void load() }, REFRESH_MS)
    return () => clearInterval(t)
  }, [isOpen, load])

  const active = data?.stages.filter((x) => x.waiting + x.running + x.failed > 0) ?? []

  return (
    <SlidePanel isOpen={isOpen} onClose={onClose} title="수집 진행 상황">
      {error ? (
        <ErrorState code="INTERNAL" message={error} />
      ) : !data ? (
        <SkelList rows={4} />
      ) : data.pending === 0 && data.dead === 0 ? (
        <EmptyState
          title="지금 처리할 일이 없습니다"
          description="링크를 넣거나 관심 채널을 등록하면 여기에 진행 상황이 나타납니다."
        />
      ) : (
        <div className={s.stack}>
          {/* 한 줄 요약 — 패널을 연 이유에 먼저 답한다 */}
          <div className={s.summary}>
            <p className={s.big}>{data.pending.toLocaleString()}건 남음</p>
            <p className={s.eta}>
              {data.etaText
                ?? '남은 시간은 아직 계산할 수 없습니다 (처리 기록이 더 쌓이면 알려드려요)'}
            </p>
            {data.perMinute != null && (
              <p className="ci-basis">최근 10분 기준 분당 {data.perMinute}건 처리 중</p>
            )}
          </div>

          {/* 단계별 — "무엇을 하는 중인가"에 답한다 */}
          <section className={s.section}>
            <h4 className={s.head}>지금 어디까지 왔나</h4>
            {active.length === 0 ? (
              <EmptyState
                title="대기 중인 단계가 없습니다"
                description="처리 중인 것이 끝나면 이 목록도 비워집니다."
              />
            ) : (
            <ol className={s.stages}>
              {active.map((st) => {
                const own = st.waiting + st.running + st.failed
                return (
                  <li key={st.stage} className={s.stage}>
                    <div className={s.stageTop}>
                      <span className={s.stageLabel}>{st.label}</span>
                      <span className={s.stageCount}>{own.toLocaleString()}건</span>
                    </div>
                    <div className={s.bar} aria-hidden>
                      <span className={s.barFill} style={{ width: `${Math.round(st.share * 100)}%` }} />
                    </div>
                    <p className={s.stageNote}>{st.note}</p>
                    {st.running > 0 && <p className="ci-basis">{st.running}건 처리 중</p>}
                    {st.failed > 0 && (
                      <p className="ci-basis">{st.failed}건 재시도 대기 중</p>
                    )}
                  </li>
                )
              })}
            </ol>
            )}
          </section>

          {/* 막힌 것 — 조용히 넘기지 않는다 */}
          {(data.recentFailures.length > 0 || data.dead > 0) && (
            <section className={s.section}>
              <h4 className={s.head}>
                막힌 것{data.dead > 0 ? ` · 포기 ${data.dead}건` : ''}
              </h4>
              <ul className={s.fails}>
                {data.recentFailures.map((f) => (
                  <li key={`${f.stage}-${f.status}-${f.message}`} className={s.fail}>
                    <span className={`ci-status ${f.status === 'dead' ? 'ci-status-danger' : 'ci-status-warn'}`}>
                      {f.stageLabel} {f.count}건
                    </span>
                    <span className={s.failMsg}>{f.message}</span>
                  </li>
                ))}
              </ul>
              {data.dead > 0 && (
                <p className="ci-basis">
                  포기한 것은 여러 번 시도해도 실패한 건입니다. 원인을 고친 뒤 다시 넣어 주세요.
                </p>
              )}
            </section>
          )}

          <button type="button" className="btn-ghost" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} aria-hidden />
            {loading ? '새로고침 중…' : '지금 새로고침'}
          </button>
        </div>
      )}
    </SlidePanel>
  )
}
