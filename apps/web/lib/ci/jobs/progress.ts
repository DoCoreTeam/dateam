// lib/ci/jobs/progress.ts — 큐 진행 상황 (순수 함수)
//
// 왜 필요한가: 화면이 "수집 중 1,017건 남음"이라고만 말했다. 숫자 하나로는
// **무엇을 하는 중인지도, 언제 끝나는지도, 뭔가 막혔는지도** 알 수 없다.
// 사용자는 그 칩을 눌러 보려 했는데 눌리지도 않았다(지적 2026-08-18).
//
// DB를 모른다. 집계된 숫자만 받아 화면이 읽을 모양으로 바꾼다 —
// 그래야 "어떻게 보여줄 것인가"를 테스트로 못 박을 수 있다.

import type { CiJobStage, CiJobStatus } from '../types.ts'
import { CI_JOB_STAGES } from '../types.ts'

/**
 * 단계 이름을 사용자 말로.
 *
 * `ingest`·`normalize`를 그대로 보여주면 사용자는 무엇이 일어나는지 알 수 없다.
 * 화면과 잡 이력이 **같은 목록**을 써야 두 곳이 다른 말을 하지 않는다.
 */
export const CI_JOB_STAGE_LABEL: Record<CiJobStage, string> = {
  ingest: '가져오기',
  normalize: '정리',
  enrich: '영상 읽기',
  classify: '주제 분류',
  verify: '확인',
  project: '지표 계산',
  signals: '이슈 찾기',
}

/** 한 줄 설명 — 왜 이 단계가 필요한지. 오래 걸릴 때 사용자가 납득할 수 있어야 한다. */
export const CI_JOB_STAGE_NOTE: Record<CiJobStage, string> = {
  ingest: '채널과 게시물의 정보를 플랫폼에서 받아옵니다',
  normalize: '받아온 값을 같은 형식으로 맞춥니다',
  enrich: '영상을 실제로 보고 대사·자막·구성을 읽습니다',
  classify: '어떤 주제인지 판정합니다',
  verify: '애매한 판정을 다시 살핍니다',
  project: '평소 대비 배수와 순위를 계산합니다',
  signals: '웹에서 지금 화제가 된 것을 찾아 이슈 후보로 담습니다',
}

export interface StageCount {
  stage: CiJobStage
  waiting: number
  running: number
  failed: number
}

export interface StageProgress extends StageCount {
  label: string
  note: string
  /** 이 단계가 지금 남은 일 전체에서 차지하는 비율 0~1 */
  share: number
}

export interface RecentFailure {
  stage: CiJobStage
  stageLabel: string
  message: string
  /** 같은 사유가 여러 건이면 묶는다 — 같은 줄을 20번 보여주면 읽히지 않는다 */
  count: number
  /** 되살릴 수 있는가. dead는 시도를 다 쓴 것이다 */
  status: CiJobStatus
}

export interface QueueProgressInput {
  stageCounts: readonly StageCount[]
  /** 시도를 다 써서 포기한 잡 */
  dead: number
  recentFailures: readonly RecentFailure[]
  /**
   * 최근 완료된 잡의 처리 시간(ms) 표본.
   * 표본이 적으면 남은 시간을 추정하지 않는다 — 없는 숫자를 지어내지 않는다.
   */
  recentDurationsMs: readonly number[]
  /** 최근 완료 건수와 그 구간(분). 처리 속도의 근거 */
  recentDoneCount: number
  recentWindowMin: number
}

export interface QueueProgress {
  waiting: number
  running: number
  failed: number
  dead: number
  /** 지금 처리 대기 중인 것 전체 */
  pending: number
  stages: StageProgress[]
  recentFailures: RecentFailure[]
  /** 분당 처리 건수. 근거가 없으면 null */
  perMinute: number | null
  /** 남은 시간(분). 근거가 없으면 null — "곧 끝납니다" 같은 거짓말을 하지 않는다 */
  etaMinutes: number | null
}

/** 처리 속도를 말할 수 있는 최소 표본. 두세 건으로 "분당 N건"이라고 하면 우연을 판다. */
export const THROUGHPUT_MIN_SAMPLE = 5

/**
 * 남은 시간 추정.
 *
 * 표본이 적거나 속도가 0이면 **null**이다. 화면이 "계산 중"이라고 말하는 편이
 * 틀린 숫자를 보여주는 것보다 낫다 — 한 번 틀리면 그 뒤로 아무도 안 믿는다.
 */
export function estimateEtaMinutes(
  pending: number, perMinute: number | null,
): number | null {
  if (pending <= 0) return 0
  if (perMinute == null || perMinute <= 0) return null
  return Math.ceil(pending / perMinute)
}

/** 남은 시간을 사람 말로. 초 단위까지 말하면 정확해 보이지만 사실 그렇지 않다. */
export function formatEta(minutes: number | null): string | null {
  if (minutes == null) return null
  if (minutes <= 0) return '곧 끝납니다'
  if (minutes < 1) return '1분 안에 끝납니다'
  if (minutes < 60) return `약 ${minutes}분 남았습니다`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `약 ${h}시간 ${m}분 남았습니다` : `약 ${h}시간 남았습니다`
}

/**
 * 집계를 화면이 읽을 모양으로.
 *
 * 단계는 **파이프라인 순서 그대로** 돌려준다(가져오기 → … → 지표 계산).
 * 건수 순으로 정렬하면 같은 화면을 다시 열 때마다 순서가 바뀌어 읽기 어렵다.
 */
export function buildQueueProgress(input: QueueProgressInput): QueueProgress {
  const byStage = new Map<CiJobStage, StageCount>(
    input.stageCounts.map((c) => [c.stage, c]),
  )

  let waiting = 0
  let running = 0
  let failed = 0
  for (const c of input.stageCounts) {
    waiting += c.waiting
    running += c.running
    failed += c.failed
  }
  // 실패는 재시도 대기 중이라 '남은 일'에 포함된다. 죽은 것(dead)은 아니다.
  const pending = waiting + running + failed

  const stages: StageProgress[] = CI_JOB_STAGES.map((stage) => {
    const c = byStage.get(stage) ?? { stage, waiting: 0, running: 0, failed: 0 }
    const own = c.waiting + c.running + c.failed
    return {
      ...c,
      label: CI_JOB_STAGE_LABEL[stage],
      note: CI_JOB_STAGE_NOTE[stage],
      share: pending > 0 ? own / pending : 0,
    }
  })

  const perMinute = input.recentDurationsMs.length >= THROUGHPUT_MIN_SAMPLE
    && input.recentWindowMin > 0 && input.recentDoneCount > 0
    ? Math.round((input.recentDoneCount / input.recentWindowMin) * 10) / 10
    : null

  return {
    waiting,
    running,
    failed,
    dead: input.dead,
    pending,
    stages,
    recentFailures: [...input.recentFailures],
    perMinute,
    etaMinutes: estimateEtaMinutes(pending, perMinute),
  }
}

/**
 * 같은 사유의 실패를 묶는다.
 * 같은 줄이 스무 번 나오면 사용자는 목록을 읽지 않는다 — 서로 다른 문제를 못 본다.
 */
export function groupFailures(
  rows: readonly { stage: CiJobStage; message: string | null; status: CiJobStatus }[],
  limit = 5,
): RecentFailure[] {
  const map = new Map<string, RecentFailure>()
  for (const r of rows) {
    const message = (r.message ?? '').trim() || '알 수 없는 오류'
    const key = `${r.stage}::${r.status}::${message}`
    const prev = map.get(key)
    if (prev) { prev.count += 1; continue }
    map.set(key, {
      stage: r.stage,
      stageLabel: CI_JOB_STAGE_LABEL[r.stage] ?? r.stage,
      message,
      count: 1,
      status: r.status,
    })
  }
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}
