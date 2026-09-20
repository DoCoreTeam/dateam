// lib/ai/actor.ts — 어느 호출에 주인이 있어야 하나 (순수 등재부)
//
// ## 왜 생겼나
//
// 실측 2026-09-20: 원장 50,243건이 **전부** actor_id 가 비어 있었다. 하루 23,318건이
// 나가는데 누가 태웠는지 한 건도 못 가렸다. 한도를 넘긴 쪽을 찾을 수도, 사람이 누른 것과
// 배경 작업을 갈라 볼 수도 없었다 — 원장이 있는데 물음에 답을 못 하는 상태였다.
//
// 원인은 기록이 아니라 **주인을 넘길 자리가 없었던 것**이다. 벤더로 나가는 파일 서른다섯 중
// 열 곳이 사용자 id 를 아예 안 받았고, 공통 호출기(gemini-call)에는 그 칸 자체가 없었다.
//
// ## 왜 목록으로 두나
//
// 「지금 있는 열 곳을 고쳤나」만 보면 서른여섯째가 생기는 날 아무도 못 잡는다. 그래서
// 벤더로 나가는 파일을 전부 여기 적고, 가드가 소스를 훑어 **적힌 것과 실제가 같은지** 본다.
// 새 자리를 만들면 등재부에 없으므로 실패하고, 관문으로 옮겨 사라지면 그것도 실패한다.
//
// 이 저장소가 이미 쓰는 방식이다 — lib/policy/vendor-call-baseline.json 과 같은 모양이고,
// 다른 점은 «몇 개 남았나»가 아니라 «누가 주인인가»를 센다는 것뿐이다.

/** 이 자리를 누가 여나 */
export type LaneKind =
  /** 사람이 눌러서 시작한다. actor_id 가 반드시 채워져야 한다 */
  | 'human'
  /** 예약·큐·훅이 부른다. 사람이 없으므로 surface 이름이 주인을 대신한다 */
  | 'background'

export interface AiLane {
  /** apps/web 기준 상대 경로 */
  file: string
  kind: LaneKind
  /** 이 파일이 여는 창구 이름들. 배경 작업은 이 이름이 원장에서 주인 노릇을 한다 */
  surfaces: readonly string[]
  /** 왜 사람이 있나 / 왜 없나. 「배경」한 마디로는 다음 사람이 판단을 못 한다 */
  why: string
  /**
   * 사람이 누르는데 **아직 주인을 안 이어 붙인** 자리.
   *
   * 지금 막으면 멀쩡히 도는 기능이 멈추므로 막지 않는다. 대신 수를 세고, 그 수는
   * 줄기만 한다 — 늘면 가드가 실패한다.
   */
  unwired?: true
}

export const AI_LANES: readonly AiLane[] = [
  // ── 사람이 눌러서 시작하고, 주인을 이미 넘기는 자리 ──────────────────────────
  { file: 'app/(member)/calendar/actions.ts', kind: 'human', surfaces: ['calendar-recommend'],
    why: '캘린더 화면에서 사람이 추천을 누른다' },
  { file: 'app/api/ai/analyze-work/route.ts', kind: 'human', surfaces: ['daily-ai-save'],
    why: '일일업무 저장을 사람이 누른다' },
  { file: 'app/api/daily/flow-reason/route.ts', kind: 'human', surfaces: ['daily-flow-reason'],
    why: '일일업무 화면에서 사람이 이유를 묻는다' },
  { file: 'app/api/daily/memos/clusters/route.ts', kind: 'human', surfaces: ['daily/memo-clusters', 'memo-cluster-label'],
    why: '메모 묶기를 사람이 누른다' },
  { file: 'app/api/deals/activities/route.ts', kind: 'human', surfaces: ['deal-activity-parse', 'deals/activities'],
    why: '딜 활동 입력을 사람이 저장한다' },
  { file: 'app/api/deals/ai-parse/route.ts', kind: 'human', surfaces: ['deal-activity-parse', 'deals/ai-parse'],
    why: '딜 붙여넣기 해석을 사람이 누른다' },
  { file: 'app/api/pricing/gpu/db-chat/route.ts', kind: 'human', surfaces: ['gpu-db-chat'],
    why: 'GPU 자료 문답을 사람이 친다' },
  { file: 'app/api/pricing/gpu/quotes/[id]/reanalyze/route.ts', kind: 'human', surfaces: ['gpu-quote-reanalyze'],
    why: '재분석을 사람이 누른다' },
  { file: 'app/api/pricing/gpu/review/[id]/recheck/route.ts', kind: 'human', surfaces: ['gpu-quote-extract'],
    why: '검수 화면에서 사람이 다시 본다' },
  { file: 'app/api/pricing/gpu/review/route.ts', kind: 'human', surfaces: ['gpu-quote-extract'],
    why: '통합입력 제출을 사람이 누른다' },
  { file: 'app/api/pricing/gpu/specs/generate/route.ts', kind: 'human', surfaces: ['gpu-spec-generate'],
    why: '스펙 생성을 사람이 누른다' },
  { file: 'app/api/reports/aggregate-stream/route.ts', kind: 'human', surfaces: ['dept-report-aggregate'],
    why: '부서 취합을 사람이 누른다' },
  { file: 'lib/crm/services/card-read.ts', kind: 'human', surfaces: ['crm/card-read'],
    why: '명함 읽기를 사람이 올린다' },
  { file: 'lib/daily/analyze-work-core.ts', kind: 'human', surfaces: ['daily/analyze-work'],
    why: '일일업무 분해는 사람의 저장에서 출발한다' },
  { file: 'lib/gemini-content-edit.ts', kind: 'human', surfaces: ['content-ai-edit'],
    why: '콘텐츠 다듬기를 사람이 누른다' },
  { file: 'lib/gemini-daily-to-weekly.ts', kind: 'human', surfaces: ['weekly-report-refine', 'weekly-report/generate'],
    why: '주간보고 생성을 사람이 누른다' },
  { file: 'lib/gemini-lead.ts', kind: 'human', surfaces: ['account-fit-score', 'lead-parse', 'leads/vision'],
    why: '리드 입력과 판정을 사람이 올린다' },
  { file: 'lib/gemini-refine.ts', kind: 'human', surfaces: ['report-preview-merge', 'weekly-report-refine'],
    why: '보고 다듬기를 사람이 누른다' },
  { file: 'lib/gemini-suggest-projects.ts', kind: 'human', surfaces: ['project-suggest'],
    why: '프로젝트 제안을 사람이 누른다' },
  { file: 'lib/gemini-suggest-tasks.ts', kind: 'human', surfaces: ['dept-task-suggest'],
    why: '부서 업무 제안을 사람이 누른다' },

  // ── 사람이 누르는데 아직 주인을 안 이어 붙인 자리 (I08c, I08d 에서 없앤다) ──────
  { file: 'app/api/admin/system-log/remedy/route.ts', kind: 'human', surfaces: ['system-log-remedy'],
    why: '관리자가 해결책을 누른다, 창구가 user.id 를 그대로 넘긴다' },
  { file: 'app/api/meeting-notes/[id]/transcript/speakers/route.ts', kind: 'human', surfaces: ['meeting-speaker-split'],
    why: '회의 화면에서 사람이 화자 나누기를 누른다, 창구가 auth.user.id 를 그대로 넘긴다' },
  { file: 'lib/gemini-meeting.ts', kind: 'human', surfaces: ['meeting_extract', 'meeting_summarize'],
    why: '회의노트 요약과 추출, 받은 userId 를 호출기까지 내려보낸다' },
  { file: 'lib/meeting/digest-run.ts', kind: 'human', surfaces: ['meeting_digest', 'meeting_digest_condense'],
    why: '회의 정리, 받은 userId 를 호출기까지 내려보낸다' },
  { file: 'lib/daily-prompt-governance.ts', kind: 'human', surfaces: ['daily-prompt-synth'],
    why: '프롬프트 개선은 사람의 일일업무 결과에서 출발한다', unwired: true },
  { file: 'lib/ai-chat/providers/gemini.ts', kind: 'human', surfaces: ['ai-chat'],
    why: 'AI 채팅, 사람이 치는 자리인데 공급자 층까지 주인이 안 내려온다', unwired: true },
  { file: 'lib/crm/ai/runner.ts', kind: 'human', surfaces: ['crm'],
    why: 'CRM AI 실행기, 부르는 쪽에 구성원이 있는데 실행기까지 안 내려온다', unwired: true },
  { file: 'lib/stt/provider.ts', kind: 'human', surfaces: ['meeting/stt'],
    why: '회의 녹음 받아쓰기, 녹음을 켠 사람이 있다', unwired: true },
  { file: 'lib/meeting/transcribe-parts.ts', kind: 'human', surfaces: ['meeting/transcribe'],
    why: '회의 녹음 조각 받아쓰기, 녹음을 켠 사람이 있다', unwired: true },
  { file: 'lib/gpu/extract-helpers.ts', kind: 'human', surfaces: [],
    why: 'GPU 통합입력 도우미, 부르는 창구에 사람이 있는데 도우미까지 안 내려온다', unwired: true },

  // ── 사람이 없는 자리. 이름이 주인을 대신한다 ────────────────────────────────
  { file: 'lib/ci/ai/creative-server.ts', kind: 'background', surfaces: ['ci-verify'],
    why: '콘텐츠 인입 큐가 부른다, 사람이 누른 순간이 없다' },
  { file: 'lib/ci/ai/discover-server.ts', kind: 'background', surfaces: ['ci-discover', 'ci-discover-cluster'],
    why: '발견 배치, 하루 1회 예약으로만 돈다' },
  { file: 'lib/ci/ai/gemini.ts', kind: 'background', surfaces: ['ci-gemini'],
    why: '콘텐츠 분석 배치, 인입 뒤에 큐가 부른다' },
  { file: 'lib/gpu/company-enrich.ts', kind: 'background', surfaces: ['gpu-company-enrich'],
    why: '회사 보강 잡, 큐에서 돈다' },
]

const BY_FILE = new Map(AI_LANES.map((l) => [l.file, l]))

export function laneOf(file: string): AiLane | null {
  return BY_FILE.get(file) ?? null
}

/** 이 자리가 지금 주인을 넘겨야 하나 */
export function needsActor(lane: AiLane): boolean {
  return lane.kind === 'human' && !lane.unwired
}

/** 아직 안 이어 붙인 사람 창구. 이 수는 줄기만 한다 */
export function unwiredLanes(): readonly AiLane[] {
  return AI_LANES.filter((l) => l.unwired)
}

/**
 * 아직 안 이어 붙인 자리의 기준선.
 *
 * 실측 2026-09-20 기준 열 곳이었다. I08b 가 넷을 없애 여섯이 남았고, I08c 가 셋,
 * I08d 가 나머지를 없앤다. 이 숫자를 올리는 변경은 가드가 막는다 —
 * 새 자리를 「나중에」로 여는 길을 안 남긴다. 줄이면 이 값도 함께 내린다.
 */
export const UNWIRED_BASELINE = 6
