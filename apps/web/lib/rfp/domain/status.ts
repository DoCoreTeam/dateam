/**
 * 파이프라인 상태와 전이 — RFP 한 건이 지나는 길 (설계서 3.3.1)
 *
 * ## 왜 표로 두나
 *
 * 인입에서 리포트까지 단계가 아홉이고, 각 단계는 **멱등**이라 실패하면 그 단계부터 다시 돈다.
 * 어느 단계에서 어디로 갈 수 있는지를 코드 여기저기의 `if` 로 흩어 두면
 * 재시도 경로가 화면마다 달라진다. 표 하나가 그 갈림을 막는다.
 *
 * ## 실패를 상태로 만들지 않는다
 *
 * `failed_parsing` 같은 값을 상태 열거형에 섞으면 전이표가 두 배로 커지고
 * 「어느 단계에서 실패했나」를 문자열 파싱으로 되읽어야 한다.
 * 그래서 실패는 **단계 + 실패 플래그**로 나눠 저장하고, 여기서는 그 짝을 만드는 함수만 준다.
 *
 * ## 여기 없는 것
 *
 * 화면에 뜨는 단계 이름은 `lib/rfp/terms.ts` 다. 이 파일은 순서와 가능한 이동만 안다.
 */

/** 단계 — 케이스가 지나는 자리 */
export type Stage =
  | 'uploaded'
  | 'classified'
  | 'parsing'
  | 'parsed'
  | 'structuring'
  | 'structured'
  | 'indexing'
  | 'indexed'
  | 'analyzing'
  | 'reported'
  | 'cross_verifying'
  | 'assessing'
  | 'assessed'
  | 'comparing'
  | 'compared'

/** 설계서 3.3.1 의 상태 기계를 그대로 옮긴 표 */
export const STAGE_TRANSITIONS: Record<Stage, readonly Stage[]> = {
  uploaded: ['classified'],
  classified: ['parsing'],
  parsing: ['parsed'],
  parsed: ['structuring'],
  structuring: ['structured'],
  structured: ['indexing'],
  indexing: ['indexed'],
  // 인덱싱이 끝나면 분석으로 간다
  indexed: ['analyzing'],
  analyzing: ['reported'],
  /**
   * 리포트가 나온 뒤는 갈래가 셋이다.
   *   · 교차검증을 걸면 cross_verifying 으로 갔다가 다시 reported(v+1)
   *   · 적합도 판정으로 바로 갈 수도 있고
   *   · 비교를 요청할 수도 있다
   * 셋 다 사용자가 고르는 것이라 순서를 강제하지 않는다.
   */
  reported: ['cross_verifying', 'assessing', 'comparing'],
  // 교차검증은 끝나면 언제나 새 리포트 버전으로 돌아온다
  cross_verifying: ['reported'],
  assessing: ['assessed'],
  assessed: ['comparing', 'cross_verifying'],
  comparing: ['compared'],
  compared: ['cross_verifying', 'assessing'],
}

/** 단계 순서 — 화면이 진행률을 그릴 때 쓴다. 갈래가 있는 뒤쪽은 순서에 뜻이 없다 */
export const STAGE_ORDER: readonly Stage[] = [
  'uploaded', 'classified', 'parsing', 'parsed', 'structuring', 'structured',
  'indexing', 'indexed', 'analyzing', 'reported', 'cross_verifying',
  'assessing', 'assessed', 'comparing', 'compared',
]

/** 더 갈 곳이 없는 단계인가 */
export function isTerminal(stage: Stage): boolean {
  return STAGE_TRANSITIONS[stage].length === 0
}

/** 이 이동이 표에 있나 — 없는 이동은 코드 실수이지 사용자 입력이 아니다 */
export function canTransition(from: Stage, to: Stage): boolean {
  return STAGE_TRANSITIONS[from].includes(to)
}

/** 단계 값인가 — DB 와 요청 본문 경계에서 검사한다 */
export function isStage(v: unknown): v is Stage {
  return typeof v === 'string' && v in STAGE_TRANSITIONS
}

/**
 * 케이스가 지금 어디 있나.
 *
 * 실패는 `stage` 를 바꾸지 않고 `failedAt` 에 그 단계를 남긴다.
 * 그래야 「어디까지 갔다가 어디서 멈췄나」가 한 행에서 읽힌다.
 */
export interface CaseProgress {
  stage: Stage
  /** 실패한 단계. null 이면 실패한 적이 없거나 재시도로 풀렸다 */
  failedAt: Stage | null
  /** 사람이 읽을 실패 사유. 실패가 없으면 null */
  failedReason: string | null
  /** 같은 단계를 몇 번 시도했나 */
  attempts: number
}

/** 실패를 기록한다 — 단계는 그대로 두고 실패 표시만 켠다 */
export function markFailed(p: CaseProgress, reason: string): CaseProgress {
  return { ...p, failedAt: p.stage, failedReason: reason, attempts: p.attempts + 1 }
}

/** 재시도로 넘어간다 — 실패 표시를 지우고 다음 단계로 */
export function advance(p: CaseProgress, to: Stage): CaseProgress {
  if (!canTransition(p.stage, to)) {
    throw new Error(`허용되지 않은 단계 이동: ${p.stage} -> ${to}`)
  }
  return { stage: to, failedAt: null, failedReason: null, attempts: 0 }
}

/** 재시도 상한 — 넘으면 사람에게 넘긴다(설계서 3.3.1 재시도는 해당 단계부터) */
export const MAX_STAGE_ATTEMPTS = 3

export function needsHuman(p: CaseProgress): boolean {
  return p.failedAt !== null && p.attempts >= MAX_STAGE_ATTEMPTS
}
