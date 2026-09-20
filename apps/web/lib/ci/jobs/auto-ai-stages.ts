// lib/ci/jobs/auto-ai-stages.ts — 사람이 안 눌러도 도는 단계들의 등재부
//
// ## 왜 목록을 손으로 적나
//
// 여기 적힌 것은 «콘텐츠 한 건이 들어올 때마다 워크스페이스 전체를 다시 훑는» 단계다.
// 그 성격이 위험하다. 훑는 범위는 자료가 쌓일수록 커지는데 부르는 횟수는 인입 건수만큼
// 늘어나서, 둘이 곱해진다.
//
// 실측 2026-09-20
//   하루 신규 콘텐츠 7.3건에 AI 호출 23,318건이 나갔다. 새 것 하나당 3,193번이다
//   그 대부분이 발견 하나였고, 그것만 「이미 봤음」 거르기와 회당 상한이 둘 다 없었다
//
// 그래서 새 단계를 여기 걸지 않으면 가드가 실패한다. 목록에 적는 순간 그 단계는
// **둘 중 하나를 증명해야 한다**: AI 를 안 쓰거나, 안 쓴 것만 고르고 회당 상한이 있거나.
//
// ## 왜 값이 아니라 글자를 적나
//
// 거르기와 상한은 각 함수 안에 흩어진 표현이라 값으로 꺼낼 수 없다. 가드가 소스에서
// 이 글자를 찾는다. 함수를 고치면서 거르기를 빼면 글자가 사라져 가드가 잡는다.

/** 이 단계가 AI 를 부르는가 */
export type AutoStageAi =
  /** 벤더를 부른다. 그러면 거르기와 상한을 둘 다 증명해야 한다 */
  | { calls: 'ai'; seenBy: string; capBy: string }
  /** 안 부른다. 가드가 실제로 안 부르는지 확인한다 */
  | { calls: 'none' }

export interface AutoStage {
  /** 함수 이름. 파생값 계산(handleProject)이 부르는 이름 그대로 */
  fn: string
  /** lib/ci 기준 상대 경로 */
  file: string
  /** 왜 사람이 안 눌러도 도는가 */
  why: string
  ai: AutoStageAi
}

/**
 * 파생값 계산이 부르는 재훑기들.
 *
 * 발견(runDiscovery)과 공식(runPatterns)은 **여기 없다.** P0030 I01 에서 단건 처리에서
 * 떼어 버튼과 배치 워커로 옮겼다. 다시 여기로 들어오면 가드가 아니라
 * trigger-scope.test.ts 가 먼저 잡는다.
 */
export const AUTO_AI_STAGES: readonly AutoStage[] = [
  {
    fn: 'runCreativeBacklog',
    file: 'jobs/stages.ts',
    why: '이 기능이 생기기 전에 모인 떡상은 파이프라인을 다시 타지 않아 영영 안 읽힌다',
    ai: { calls: 'ai', seenBy: 'ci_content_creative', capBy: 'CREATIVE_MAX_PER_PASS' },
  },
  {
    fn: 'runMediaBacklog',
    file: 'jobs/stages.ts',
    why: '같은 이유. 읽은 적 없는 영상을 뒤늦게 메운다',
    ai: { calls: 'ai', seenBy: 'shouldUnderstand', capBy: 'MEDIA_MAX_PER_PASS' },
  },
  {
    fn: 'enrichChannelMetaBacklog',
    file: 'jobs/stages.ts',
    why: '콘텐츠 수집이 만든 채널은 이름과 주소뿐이라 정보를 채워야 한다',
    ai: { calls: 'none' },
  },
  {
    fn: 'enrichContextBacklog',
    file: 'analysis/context-enrich.ts',
    why: '계절·요일·시간대는 나중에 생긴 칸이라 옛 자료에 비어 있다',
    ai: { calls: 'none' },
  },
  {
    fn: 'runAlertBacklog',
    file: 'alerts/evaluate.ts',
    why: '배수가 바뀌면 알림 조건도 다시 봐야 한다',
    ai: { calls: 'none' },
  },
]

/**
 * 벤더를 부르는 것으로 치는 표현들.
 *
 * 창구를 새로 만들면 여기 더해야 한다. 안 더하면 그 창구로 나가는 호출은
 * 가드 눈에 안 보이고, 「AI 를 안 쓴다」고 적힌 단계가 실제로는 쓰게 된다.
 */
export const AI_CALL_MARKERS: readonly string[] = [
  'callGeminiJson',
  'callGeminiText',
  'guardedGeminiText',
  'guardedGeminiChat',
  'guardedText',
  'guardedMedia',
  'analyzeCreative',
  'understandMedia',
  'discoverFromContrasts',
]

/** AI 를 부르는 단계만 */
export function aiStages(): AutoStage[] {
  return AUTO_AI_STAGES.filter((s) => s.ai.calls === 'ai')
}
