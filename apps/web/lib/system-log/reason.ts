// lib/system-log/reason.ts — 오류 하나를 **사유 한 가지**로 접는다 (순수 함수)
//
// 새 분류 체계를 만들지 않는다. 이미 있는 판정을 합치기만 한다:
//   · `GeminiFailureReason`      — lib/ai/gemini-call.ts (v0.7.571)
//   · `classifyProviderError()`  — lib/ai-chat/provider-errors.ts
//   · Prisma 오류코드            — 여기서 매핑(작다)
//
// **왜 접는가**: 사유가 곧 화면의 필터이고, 관리자가 "내가 고칠 수 있는 것인가"를
// 가르는 첫 단서다. 원인마다 다른 이름을 쓰면 필터가 20개가 되고 아무도 안 쓴다.

import type { GeminiFailureReason } from '../ai/gemini-call.ts'

export type SystemReason =
  | 'quota' | 'auth' | 'config' | 'db'
  | 'timeout' | 'network' | 'server' | 'bad_json' | 'unknown'

export type SystemSeverity = 'critical' | 'error' | 'warn'

/** Gemini SSOT 의 사유를 그대로 옮긴다 — 뜻이 같은 것을 다른 말로 부르지 않는다 */
const FROM_GEMINI: Record<GeminiFailureReason, SystemReason> = {
  timeout: 'timeout',
  auth: 'auth',
  quota: 'quota',
  no_model: 'config',
  bad_json: 'bad_json',
  truncated: 'bad_json',
  network: 'network',
  server: 'server',
}

/**
 * Prisma 오류코드 → 사유.
 *
 * P2021(표 없음)·P2022(칼럼 없음)은 **마이그레이션이 안 갔다**는 뜻이라 `db` 로 접는다.
 * 실측(v0.7.572): 프로덕션에 `DATABASE_URL` 이 없어 CRM 전체가 500 이었는데,
 * 로그에는 Prisma 스택만 남아 아무도 그 사실을 몰랐다.
 */
const FROM_PRISMA: Record<string, SystemReason> = {
  P1000: 'auth',      // 인증 실패
  P1001: 'db',        // 서버에 닿지 않음
  P1002: 'timeout',
  P1003: 'db',        // 데이터베이스가 없음
  P1017: 'db',        // 연결이 닫힘
  P2002: 'unknown',   // 중복 — 사용자 입력이지 장애가 아니다
  P2021: 'db',        // 표가 없음 → 마이그레이션 미적용
  P2022: 'db',        // 칼럼이 없음 → 마이그레이션 미적용
  P2024: 'timeout',   // 커넥션 풀 대기 초과
}

/**
 * CRM 도메인 오류 코드 → 사유.
 *
 * **왜 필요한가**(2026-08-24 실측): 어댑터가 `CrmError('PROVIDER_QUOTA', 'AI 웹 검색 한도를…')`
 * 를 던지자 사유가 `unknown` 으로 잡혔다. 메시지가 **우리말**이라 영어 패턴(429·quota)에
 * 하나도 안 걸렸기 때문이다. 코드가 이미 사유를 말하고 있는데 문장을 추측한 셈이다.
 */
const FROM_CRM: Record<string, SystemReason> = {
  PROVIDER_QUOTA: 'quota',
  UNAUTHORIZED: 'auth',
  FORBIDDEN: 'auth',
  AI_PARSE_FAILED: 'bad_json',
  VALIDATION_FAILED: 'unknown',   // 사용자 입력 문제라 장애가 아니다
}

const PATTERNS: [RegExp, SystemReason][] = [
  [/\b429\b|quota|resource_exhausted|rate.?limit/i, 'quota'],
  [/\b401\b|\b403\b|api.?key|unauthorized|permission|invalid.?credential/i, 'auth'],
  [/환경변수|env var|is not (defined|set)|missing .*(key|url|token)|not configured/i, 'config'],
  [/\bP\d{4}\b|prisma|relation .* does not exist|database/i, 'db'],
  [/timeout|timed out|abort|deadline/i, 'timeout'],
  [/econnrefused|enotfound|network|fetch failed|socket hang up/i, 'network'],
  [/\b5\d\d\b|internal server error|service unavailable/i, 'server'],
  [/json|unexpected token|parse/i, 'bad_json'],

  /*
    ## 우리말로 쓴 문장 (여기서부터)

    위 여덟 줄은 전부 영어다. 그런데 **우리가 던지는 오류 문장은 우리말이다.**
    그래서 우리가 쓴 문장은 하나도 안 걸리고 전부 `unknown` 이 됐다
    (실측 2026-09-20: ci_job 사건 267건이 전부 `unknown`, 그중 246건이
    「한도를 다 썼습니다」라고 원문에 또렷이 적혀 있었다).

    이 파일 위 `FROM_CRM` 주석이 같은 사고를 이미 적어 뒀지만, 그때는
    **코드를 든 오류**만 구했다. 코드를 잃고 문장만 남은 길이 그대로 열려 있었다.

    ### 왜 영어 뒤에 두나

    앞 여덟 줄의 판정을 한 건도 안 바꾸기 위해서다. 우리말을 앞에 두면
    「Gemini API 오류 (429)」처럼 섞인 문장에서 우리말이 먼저 이겨 버린다.

    ### 왜 「초과」만으로 안 잡나

    실측 원문에 「현물 합계가 수주 매출을 넘습니다 — 960,000,000원 초과」가 있다.
    이건 한도가 아니라 **사람이 넣은 값**이다. 맨 「초과」로 잡으면 장사 이야기가
    시스템 한도로 둔갑하고, 관리자는 있지도 않은 한도를 풀러 간다.
    그래서 「한도」·「할당량」·「쿼터」·「사용량 초과」처럼 **한도를 뜻하는 말이
    붙어 있을 때만** 잡는다.

    시간 초과와 연결 실패는 여기 없다. 그 뜻으로 우리말을 던지는 자리를
    못 찾았기 때문이다 — 안 나는 일에 규칙을 먼저 두지 않는다.
  */
  [/한도|할당량|쿼터|사용량\s*초과/, 'quota'],
  [/권한이?\s*(없|부족|필요)|인증이\s*만료|키\s*인증|키가\s*유효하지\s*않|승인되지\s*않/, 'auth'],
  [/키가\s*(설정되지|등록되지|없)|저장된\s*[^\s]*\s*키가\s*없|쓸\s*수\s*있는[^.]*모델이\s*없|꺼져\s*있습니다/, 'config'],
  [/응답\s*형식이|응답을\s*파싱|파싱\s*실패|응답이\s*비어/, 'bad_json'],
]

/**
 * 무엇이든 받아 사유 하나로 접는다.
 *
 * 순서가 규칙이다 — **구체적인 신호를 먼저 본다.** 문자열 패턴은 마지막이다.
 * 거꾸로 하면 "429" 를 담은 Prisma 오류가 `db` 로 잡혀 한도 문제를 영영 못 본다.
 */
export function classifySystemReason(input: {
  geminiReason?: GeminiFailureReason | null
  prismaCode?: string | null
  crmCode?: string | null
  message?: string | null
}): SystemReason {
  if (input.geminiReason && FROM_GEMINI[input.geminiReason]) return FROM_GEMINI[input.geminiReason]
  if (input.crmCode && FROM_CRM[input.crmCode]) return FROM_CRM[input.crmCode]
  if (input.prismaCode && FROM_PRISMA[input.prismaCode]) return FROM_PRISMA[input.prismaCode]
  const msg = input.message ?? ''
  for (const [re, reason] of PATTERNS) if (re.test(msg)) return reason
  return 'unknown'
}

/**
 * 얼마나 급한가.
 *
 * 기준은 **"지금 사용자가 못 쓰고 있는가"** 하나다. 원인이 우리 잘못인지가 아니다 —
 * 남의 서비스 탓이어도 화면이 안 열리면 관리자는 지금 알아야 한다.
 */
export function severityOf(reason: SystemReason, opts: { blocksUser?: boolean } = {}): SystemSeverity {
  // 설정 누락·DB 는 고칠 때까지 **계속** 안 된다. 기다린다고 나아지지 않는다.
  if (reason === 'config' || reason === 'db' || reason === 'auth') return 'critical'
  if (opts.blocksUser) return 'error'
  // 한도·시간초과·네트워크는 지나가기도 한다 — 다만 반복되면 화면이 횟수로 말한다
  if (reason === 'quota' || reason === 'timeout' || reason === 'network') return 'warn'
  return 'error'
}

/**
 * 지문 — 같은 일을 한 줄로 접는 열쇠.
 *
 * 정규화가 핵심이다. `crm_company` 표가 12번 없어도 한 줄이어야 한다.
 * 안 묶으면 로그가 500줄이 되고, **500줄은 아무도 안 읽는다.**
 *
 * 해시를 쓰지 않고 읽히는 문자열로 둔다 — 지문 자체가 디버깅 단서이고,
 * DB 에서 눈으로 훑을 수 있어야 한다(해시는 사람이 대조할 수 없다).
 */
export function normalizeMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\bc[a-z0-9]{24}\b/gi, ':id')            // cuid (Prisma 기본)
    .replace(/"[^"]*"|'[^']*'/g, ':v')
    .replace(/\b\d[\d,._]*\b/g, ':n')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

export function fingerprintOf(source: string, reason: SystemReason, message: string): string {
  return `${source}|${reason}|${normalizeMessage(message)}`
}
