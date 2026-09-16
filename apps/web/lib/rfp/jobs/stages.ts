/**
 * 파이프라인 단계와 잡 종류 (설계서 3.5.1)
 *
 * ## 단계와 잡은 다른 것이다
 *
 * 단계(stage)는 **케이스가 어디까지 왔나**이고, 잡(job)은 **다음에 무엇을 돌릴까**다.
 * 둘을 하나로 두면 「파싱 중」인 케이스에 파싱 잡이 두 개 걸려도 아무도 모른다.
 *
 * ## 멱등이 규칙인 이유
 *
 * 워커는 죽는다. 죽은 워커가 집어 갔던 잡은 되살아나 **다시 돈다.**
 * 같은 단계를 두 번 돌려도 결과가 같아야 그 되살림이 안전하다.
 * 그래서 각 단계는 «만들기» 가 아니라 «있으면 덮고 없으면 만들기» 로 쓴다.
 */

import type { Stage } from '../domain/status.ts'
import { STAGE_TRANSITIONS, MAX_STAGE_ATTEMPTS } from '../domain/status.ts'

/** 워커가 아는 잡 종류 */
export type JobType =
  | 'parse'        // 파일 → IR
  | 'structure'    // IR → 섹션 트리와 요구사항
  | 'index'        // 청크와 임베딩
  | 'analyze'      // 리포트 채우기
  | 'cross_verify' // 다른 모델로 다시 채우고 대조
  | 'assess'       // 적합도 판정
  | 'compare'      // 유사 공고 비교

export const JOB_TYPES: readonly JobType[] = [
  'parse', 'structure', 'index', 'analyze', 'cross_verify', 'assess', 'compare',
]

/** 이 잡이 끝나면 케이스는 어느 단계가 되나 */
export const JOB_RESULT_STAGE: Record<JobType, Stage> = {
  parse: 'parsed',
  structure: 'structured',
  index: 'indexed',
  analyze: 'reported',
  cross_verify: 'reported',
  assess: 'assessed',
  compare: 'compared',
}

/** 이 잡이 도는 동안 케이스는 어느 단계인가 */
export const JOB_RUNNING_STAGE: Record<JobType, Stage> = {
  parse: 'parsing',
  structure: 'structuring',
  index: 'indexing',
  analyze: 'analyzing',
  cross_verify: 'cross_verifying',
  assess: 'assessing',
  compare: 'comparing',
}

/** 급한 것부터. 숫자가 작을수록 먼저 */
export const JOB_PRIORITY: Record<JobType, number> = {
  parse: 1, structure: 2, index: 3, analyze: 4,
  cross_verify: 6, assess: 5, compare: 7,
}

/**
 * 기본 파이프라인 순서.
 *
 * 교차검증·비교는 여기 없다 — **사용자가 고를 때만** 돈다.
 * 자동으로 돌리면 공개 문서 한 건에 모델 세 개를 태우고 비용이 세 배가 된다.
 */
export const DEFAULT_PIPELINE: readonly JobType[] = ['parse', 'structure', 'index', 'analyze']

/**
 * 실행기가 실제로 붙어 있는 단계.
 *
 * `JOB_TYPES` 는 **이름이 있는 단계**이고 이것은 **도는 단계**다. 둘은 다르다.
 * 교차검증은 이름도 있고 우선순위도 있고 화면 버튼도 있었는데 실행기가 없었다.
 * 누르면 잡이 걸리고 202 가 돌아오고, 그 잡은 **반드시 실패했다** (실측 2026-09-16).
 *
 * 202 를 받고 결과를 기다리다 실패하는 것보다, 걸기 전에 안 된다고 듣는 편이 낫다.
 * 새 실행기를 붙이면 여기 이름을 같이 더한다 — 가드가 이 목록과 실제 case 를 대조한다.
 */
export const RUNNABLE_JOB_TYPES: readonly JobType[] = ['parse', 'structure', 'index', 'analyze']

/** 이 단계에 실행기가 붙어 있나 */
export function isRunnable(jobType: JobType): boolean {
  return RUNNABLE_JOB_TYPES.includes(jobType)
}

/** 이 잡 다음에 자동으로 걸 잡. 없으면 파이프라인 끝 */
export function nextJob(done: JobType): JobType | null {
  const i = DEFAULT_PIPELINE.indexOf(done)
  if (i < 0 || i === DEFAULT_PIPELINE.length - 1) return null
  return DEFAULT_PIPELINE[i + 1]
}

/**
 * 같은 단계를 두 번 걸지 않기 위한 키.
 *
 * 재처리는 `version` 을 올려 **새 키**를 만든다 — 같은 키로 다시 넣으면
 * DB 가 있던 잡을 돌려주므로 «다시 돌리기» 가 조용히 무시된다.
 */
export function dedupeKey(caseId: string, jobType: JobType, version = 1): string {
  return `${caseId}:${jobType}:v${version}`
}

/** 이 단계로 갈 수 있나 — 상태기계가 허용하는 이동만 한다 */
export function canAdvance(from: Stage, to: Stage): boolean {
  return (STAGE_TRANSITIONS[from] ?? []).includes(to)
}

export { MAX_STAGE_ATTEMPTS }
