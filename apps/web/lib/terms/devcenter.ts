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
} as const
