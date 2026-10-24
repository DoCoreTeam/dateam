// 개발자센터 시작하기 절의 말 (SSOT, P0168)
//
// 빠른 시작은 세 단계다, 키 만들기 → GET /me → 계정 권한으로 고른 첫 목록
// 예전에는 첫 요청이 GET /products 라서 GPU 권한이 없는 계정은 첫 줄부터 403 을 받았다
// 응답 봉투와 한도 헤더 문장은 lib/public-api/respond.ts, lib/publicApiAuth.ts 의 동작과 같아야 한다
// 대조는 lib/api-docs/devcenter-docs.test.ts 가 한다

import { SERVICE_LABEL } from './entity.ts'

/** 기본 분당 한도, lib/publicApiAuth.ts DEFAULT_RATE_LIMIT 와 같다 (가드가 대조) */
export const DEVCENTER_DEFAULT_RATE_LIMIT = 60

export const DEVCENTER_START = {
  eyebrow: '사내 자동화 API',
  title: '개발자 문서',
  description: '사내 시스템을 스크립트로 다루기 위한 API입니다. 사내 계정으로 발급한 키를 씁니다.',
  inheritTitle: '이 API는 사내용입니다',
  baseUrlTitle: 'Base URL',
  quickTitle: '빠른 시작',
  quickIntro:
    '키를 만들고, 그 키가 무엇을 할 수 있는지 확인한 뒤, 그 키로 읽을 수 있는 목록을 부릅니다. 코드 예시는 위에서 고른 언어를 따릅니다.',
  step1Title: '1. 키 만들기',
  step1Body:
    '「내 키 관리」에서 키를 만듭니다. 키 값은 만든 직후 한 번만 보이므로 바로 AX_API_KEY 환경변수에 넣습니다. 키는 서버에서만 씁니다. 브라우저에 두면 사용자에게 노출됩니다.',
  step1Link: '내 키 관리',
  step2Title: '2. 키 확인 (GET /me)',
  step2Body:
    '첫 요청은 GET /me 입니다. 범위와 상관없이 부를 수 있어 권한 때문에 막히지 않습니다. 키를 만든 계정의 역할(role), 실제로 쓸 수 있는 범위(scopes), 분당 한도(rateLimitPerMinute), 만료 시각(expiresAt), 이번 분에 남은 요청 수(remainingThisMinute)를 돌려줍니다. 401 이면 키 값을, 403 이면 키가 폐기되거나 만료되지 않았는지 확인합니다.',
  step3Title: '3. 첫 목록 부르기',
  step3Body:
    '목록 조회는 모두 read 범위면 되지만, 어느 목록을 읽을 수 있는지는 키를 만든 계정의 권한이 정합니다. 아래 표에서 내 계정에 맞는 줄을 골라 그 경로로 부르세요. 예시는 표의 첫 줄입니다.',
  step3Head: { path: '첫 목록', title: '내용', requires: '필요한 권한' },
  step3Forbidden: '권한이 없는 목록을 부르면 403 입니다. 각 엔드포인트에 필요한 권한은 엔드포인트 설명에 있습니다.',
  authTitle: '인증',
  envelopeTitle: '응답 형식',
  envelopeBody: '성공과 실패 모두 같은 봉투를 씁니다. 목록은 meta 에 커서와 총 건수가 들어갑니다.',
  topLevelTitle: '목록 응답은 meta 의 값을 최상위에도 싣습니다',
  topLevelBody:
    `${SERVICE_LABEL.crm}, ${SERVICE_LABEL.ci}, 이관 중인 구 CRM 목록은 meta 의 nextCursor, hasMore, capped, total 가운데 값이 있는 것을 최상위에도 함께 내보냅니다. 예전 스크립트가 깨지지 않게 남긴 것이므로 새 코드는 meta 를 읽으세요. GPU 가격 목록은 meta 에만 싣습니다.`,
  paginationTitle: '페이지네이션',
  rateTitle: '요청 한도',
  rateBody:
    `키마다 분당 한도가 있습니다(기본 ${DEVCENTER_DEFAULT_RATE_LIMIT}회, 키별로 조정 가능). 키 확인을 통과한 요청의 응답에는 남은 횟수가 실립니다.`,
  rateNoHeaderTitle: '한도 헤더가 없는 응답',
  rateNoHeaderBody:
    '키가 없거나 틀린 401, 그리고 키가 폐기되거나 만료되거나 범위가 모자라거나 발급한 계정을 쓸 수 없는 403 처럼 키 확인에서 거절된 응답에는 한도 헤더가 없고, 그 요청은 한도에 세지 않습니다. 키 확인을 통과한 뒤 계정 권한이 없어 받은 403 에는 한도 헤더가 실립니다.',
  rateOverTitle: '한도를 넘으면',
  // 아래 문장의 `…` 는 화면이 코드 글꼴로 그린다 (app/develop/page.tsx 의 WithCode)
  authBody:
    '모든 요청에 `X-API-Key` 헤더가 필요합니다. `Authorization: Bearer <키>` 도 같게 동작합니다. 키는 HMAC-SHA256으로 해시해 저장하며, 「내 키 관리」에서 발급하고 폐기합니다.',
  authDeactivatedBody: '키를 발급한 계정이 비활성화되면 그 키도 즉시 막힙니다. 퇴사자의 키가 계속 살아 있는 것을 막습니다.',
  envelopeSample: `// 성공
{
  "success": true,
  "data": [ … ],
  "meta": { "total": 373, "nextCursor": "…", "hasMore": true }
}

// 실패, 사람이 읽을 수 있는 말로 옵니다
{
  "success": false,
  "error": "분당 요청 한도(${DEVCENTER_DEFAULT_RATE_LIMIT}회)를 넘었습니다. 12초 후 다시 시도해 주세요."
}`,
  paginationBody: '목록은 커서 방식입니다. 응답의 `meta.nextCursor`를 다음 요청의 `cursor`에 그대로 넣습니다.',
  rateHeaderSample: `X-RateLimit-Limit: ${DEVCENTER_DEFAULT_RATE_LIMIT}
X-RateLimit-Remaining: 41
X-RateLimit-Reset: 1756281600   # 이 분 창이 끝나는 시각(Unix)`,
  rateOverBody:
    'HTTP 429와 `Retry-After`(초)를 돌려줍니다. 그 시간만큼 기다린 뒤 다시 부르세요. 많은 데이터를 받을 때는 `limit`을 키우고 커서로 이어 받는 편이 다시 시도하는 것보다 빠릅니다.',
} as const

/** 엔드포인트 한 건을 그리는 자리의 말 (P0168) */
export const DEVCENTER_ENDPOINT = {
  paramHead: { field: '필드', type: '타입', desc: '설명' },
  required: '필수',
  deprecatedBadge: '이관 중',
  deprecatedTitle: '이 엔드포인트는 이관 중입니다',
  queryTitle: '쿼리 파라미터',
  bodyTitle: '요청 본문',
  fileTitle: '파일 응답',
  responseFieldsTitle: '응답 data 필드',
} as const

/**
 * 복사 단추의 결과 (P0168)
 * 예전에는 클립보드 쓰기가 거절돼도 「복사됨」을 띄웠다, 이제 성공했을 때만 띄우고 실패는 이 문장으로 말한다
 */
export const DEVCENTER_COPY = {
  failed: '복사하지 못했습니다. 코드를 직접 골라 복사해 주세요.',
} as const

/**
 * 왼쪽 목록의 말 (P0168)
 * 참고 묶음은 예전 OpenAPI 한 절에 GET /me, 승인 요청, 스펙이 같이 있던 것을 셋으로 나눈 것이다
 * 도구 묶음은 키로 직접 부르는 길 둘(CLI, 직접 실행)이다
 */
export const DEVCENTER_NAV = {
  refGroup: '참고',
  toolsGroup: '도구',
  me: '내 키',
  approval: '승인',
  spec: '스펙',
  errors: '오류 코드',
  demo: '직접 실행',
  toc: '목차',
  startGroup: '시작하기',
  startItem: '개요, 인증, 한도',
  endpointGroup: '엔드포인트',
} as const

/** 참고 세 절의 이름, 키는 app/develop/develop-nav.ts 의 REF_SECTION_ENDPOINT 와 같다 */
export const DEVCENTER_REF_LABEL = {
  'ref-me': DEVCENTER_NAV.me,
  'ref-approval': DEVCENTER_NAV.approval,
  'ref-spec': DEVCENTER_NAV.spec,
} as const
