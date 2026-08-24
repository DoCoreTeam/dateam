// lib/system-log/playbook.ts — AI 없이 우리가 **미리 써 둔 해결 방법**
//
// ## 왜 필요한가 — 자기 참조를 끊는다
//
// 이 화면이 있는 이유가 "AI 한도가 없으면 그런 걸 체크"다.
// 그런데 한도가 바닥난 사건의 해결 방법을 **AI 에게 물으면 그것도 실패한다.**
// 관측 도구가 관측 대상에 의존하면 정작 필요할 때 아무 말도 못 한다.
//
// 그래서 원인이 분명한 사유(한도·키·설정·DB)는 **우리가 답을 안다.** 미리 적어 둔다.
// AI 는 우리가 모르는 것(`unknown`·`server`·`bad_json`)에만 쓴다.
//
// 이 답들은 이 저장소에서 **실제로 겪은 일**에서 나왔다 — 일반론이 아니다.

export interface Remedy {
  diagnosis: string
  confidence: 'high' | 'low' | 'unknown'
  checks: string[]
  actions: { what: string; risk: 'safe' | 'careful'; reversible: boolean }[]
  files?: string[]
  isPlaybook: boolean
}

const PLAYBOOKS: Partial<Record<string, Remedy>> = {
  quota: {
    diagnosis: 'AI 사용 한도를 다 썼습니다. 키 하나를 여러 기능이 나눠 쓰기 때문에, 한도가 차면 회의노트·GPU·AI 채팅·CRM 이 한꺼번에 멈춥니다.',
    confidence: 'high',
    checks: [
      '관리자 → AI 사용량에서 이번 달 사용량이 한도에 닿았는지 확인',
      'Google AI Studio 콘솔에서 해당 키의 잔여 할당량 확인',
      '시스템 로그에서 같은 시각에 다른 기능도 실패했는지 확인 — 여러 기능이 동시에 죽었다면 키 문제가 맞습니다',
    ],
    actions: [
      { what: '한도가 회복될 때까지 기다린다(무료 등급은 보통 하루 단위로 초기화)', risk: 'safe', reversible: true },
      { what: '시스템 설정 → 통합에서 다른 모델로 바꾼다 — 모델마다 할당량이 따로입니다', risk: 'safe', reversible: true },
      { what: '결제 등급을 올리거나 별도 키를 발급해 기능별로 나눈다', risk: 'careful', reversible: true },
    ],
    files: ['app/admin/settings (통합)', 'apps/web/lib/ai/gemini-model.ts'],
    isPlaybook: true,
  },
  auth: {
    diagnosis: 'AI 키가 없거나, 틀렸거나, 권한이 없습니다.',
    confidence: 'high',
    checks: [
      '시스템 설정 → 통합에서 키가 저장돼 있는지 확인',
      '해당 카드의 「연결 테스트」를 눌러 지금 유효한지 확인',
      '프로덕션 환경변수에 키가 들어 있는지 확인(로컬에만 있는 경우가 잦습니다)',
    ],
    actions: [
      { what: '시스템 설정 → 통합에서 키를 다시 넣고 「연결 테스트」', risk: 'safe', reversible: true },
      { what: '키가 유출된 정황이 있으면 새로 발급하고 이전 키를 폐기', risk: 'careful', reversible: false },
    ],
    files: ['app/admin/settings/integration-ui.tsx'],
    isPlaybook: true,
  },
  config: {
    diagnosis: '실행에 필요한 설정값이 없습니다. 로컬에서는 되는데 배포에서만 실패한다면 거의 이 경우입니다.',
    confidence: 'high',
    checks: [
      '`apps/web/.env.example` 과 배포 환경변수를 대조 — 어떤 값이 필요한지가 여기 적혀 있습니다',
      '배포 대시보드의 환경변수 개수가 `.env.example` 항목 수와 맞는지 확인',
      '값을 넣은 뒤 재배포했는지 확인 — 환경변수는 새 빌드부터 적용됩니다',
    ],
    actions: [
      { what: '배포 환경변수에 빠진 값을 채우고 재배포', risk: 'safe', reversible: true },
    ],
    files: ['apps/web/.env.example'],
    isPlaybook: true,
  },
  db: {
    diagnosis: '데이터베이스에 닿지 못했거나, 코드가 기대하는 표·칼럼이 아직 없습니다. 후자라면 마이그레이션이 적용되지 않은 것입니다.',
    confidence: 'high',
    checks: [
      '`./scripts/migrate.sh --status` 로 적용 안 된 마이그레이션이 있는지 확인',
      '오류 원문에 나온 표 이름이 `supabase/migrations/` 의 어느 파일에서 만들어지는지 확인',
      '`DATABASE_URL` 이 배포 환경변수에 있는지 확인 — 없으면 CRM 전체가 500 이 됩니다(실제 사례)',
    ],
    actions: [
      { what: '`./scripts/migrate.sh <파일>` 로 밀린 마이그레이션 적용', risk: 'careful', reversible: false },
      { what: '접속 자체가 안 되면 데이터베이스 상태와 접속 문자열을 먼저 확인', risk: 'safe', reversible: true },
    ],
    files: ['scripts/migrate.sh', 'supabase/migrations/'],
    isPlaybook: true,
  },
  timeout: {
    diagnosis: '정해진 시간 안에 응답이 오지 않았습니다. 한 번에 처리하는 양이 많거나, 함수 실행 시간 상한에 걸린 것입니다.',
    confidence: 'low',
    checks: [
      '한 번에 처리한 건수가 평소보다 많았는지 확인',
      '해당 API 라우트에 `export const maxDuration` 선언이 있는지 확인 — 없으면 기본 상한에서 잘립니다',
      '같은 일이 특정 시간대에만 나는지 확인',
    ],
    actions: [
      { what: '한 번에 처리하는 건수를 줄여 다시 시도', risk: 'safe', reversible: true },
      { what: '오래 걸리는 라우트에 `maxDuration` 을 선언', risk: 'safe', reversible: true },
    ],
    isPlaybook: true,
  },
  network: {
    diagnosis: '외부 서비스에 연결하지 못했습니다. 대개 저절로 풀립니다.',
    confidence: 'low',
    checks: [
      '같은 지문이 지금도 계속 늘고 있는지 확인 — 멈췄다면 이미 지나간 일입니다',
      '해당 외부 서비스의 상태 페이지 확인',
    ],
    actions: [{ what: '잠시 뒤 다시 시도', risk: 'safe', reversible: true }],
    isPlaybook: true,
  },
}

/**
 * 웹 검색(그라운딩) 한도는 **일반 한도와 다른 바구니**다.
 *
 * 실측(2026-08-24): 같은 키로 일반 호출은 65초 뒤 200 으로 돌아오는데(분당 한도),
 * `google_search` 를 켠 호출은 기다려도 계속 429였다. 그래서 일반 한도용 조언
 * ("다른 모델로 바꾸세요")을 그대로 주면 **틀린 답**이 된다 —
 * 모든 모델이 같은 그라운딩 한도를 나눠 쓰기 때문이다.
 */
const WEB_SEARCH_QUOTA: Remedy = {
  diagnosis: 'AI 웹 검색 한도를 다 썼습니다. 일반 AI 호출과 다른 한도라, 채팅·요약 같은 기능은 멀쩡한데 웹에서 찾아오는 기능(회사 정보 보강 등)만 안 되는 상태입니다.',
  confidence: 'high',
  checks: [
    'AI 채팅이나 요약 기능은 되는지 확인 — 그것들이 되면 일반 한도가 아니라 웹 검색 한도 문제가 맞습니다',
    'Google AI Studio 콘솔에서 Grounding with Google Search 항목의 잔여 한도 확인',
    '시스템 로그에서 실패한 기능이 전부 「웹에서 찾는」 기능인지 확인',
  ],
  actions: [
    { what: '한도가 초기화될 때까지 기다린다(보통 하루 단위)', risk: 'safe', reversible: true },
    { what: '요금제를 올려 웹 검색 한도를 늘린다', risk: 'careful', reversible: true },
  ],
  files: ['apps/web/lib/crm/ai/adapters/host.ts'],
  isPlaybook: true,
}

/**
 * 이 사유는 우리가 답을 안다 — AI 를 부르지 않는다.
 *
 * `context.webSearch` 가 켜져 있던 실패면 웹 검색 한도용 답을 준다.
 * 안 그러면 "다른 모델로 바꾸세요"라는 **먹히지 않는 조언**을 하게 된다.
 */
export function playbookFor(reason: string, context?: Record<string, unknown> | null): Remedy | null {
  if (reason === 'quota' && context?.webSearch === true) return WEB_SEARCH_QUOTA
  return PLAYBOOKS[reason] ?? null
}

/**
 * AI 에게 물어야 하는가.
 *
 * **한도 사유에는 절대 묻지 않는다** — 그 요청이 또 429 로 돌아오고,
 * 화면은 "해결 방법을 가져오지 못했습니다"만 남긴다. 정작 그때가 답이 가장 필요한 순간이다.
 */
export function shouldAskAi(reason: string, context?: Record<string, unknown> | null): boolean {
  return playbookFor(reason, context) === null
}
