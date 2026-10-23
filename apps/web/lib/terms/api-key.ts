// 공개 API 키 화면의 말 (SSOT, P0158 I05)
//
// 범위 이름(read write approve send delete admin)은 CLI 와 API 응답의 requiredScope 에 그대로 나간다
// 화면은 그 이름 옆에 무엇을 할 수 있는지를 붙인다, 이름을 한국어로 바꾸면 CLI 오류와 화면이 다른 말을 한다

import type { Scope } from '../actions/types.ts'

/** 범위 하나가 무엇을 허락하는가 */
export const API_KEY_SCOPE: Record<Scope, string> = {
  read: '조회',
  write: '만들기와 수정',
  approve: '승인',
  send: '발송',
  delete: '삭제',
  admin: '관리자 설정',
}

/** 범위 밖 위험 동작은 막지 않고 승인 요청이 된다는 안내 */
export const API_KEY_APPROVAL_HINT =
  '고르지 않은 승인 발송 삭제 관리자 설정은 바로 실행되지 않고 내 승인을 기다립니다'

export const API_KEY_FIELD = {
  name: 'API 키 이름',
  purpose: '쓰는 곳',
  purposePlaceholder: '예: 영업 자동화 스크립트',
  scopes: '범위',
  expiresIn: '만료',
  expiresAt: '만료일',
  noExpiry: '만료 없음',
  expired: '만료됨',
} as const

/** 만료 기간 선택지, 일 단위 */
export const API_KEY_EXPIRY_OPTIONS: readonly { days: number; label: string }[] = [
  { days: 30, label: '30일' },
  { days: 90, label: '90일' },
  { days: 180, label: '180일' },
  { days: 365, label: '1년' },
]

export const API_KEY_DEFAULT_EXPIRY_DAYS = 90

/** 만든 직후 한 번만 보이는 키 안내 */
export const API_KEY_ONCE =
  '이 키는 지금 한 번만 보입니다. 닫으면 다시 볼 수 없으니 안전한 곳에 보관하세요'

/** 만들기 창구가 돌려주는 오류 코드별 안내, 코드를 그대로 화면에 싣지 않는다 */
export const API_KEY_ERROR: Record<string, string> = {
  invalid_request: '이름, 범위, 만료를 다시 확인해 주세요. 범위는 하나 이상 골라야 합니다',
  scope_not_allowed: '내 계정 권한으로 고를 수 없는 범위가 있습니다',
  create_failed: '키를 만들지 못했습니다. 잠시 후 다시 시도해 주세요',
}

/** 승인 요청 화면 (P0158 I08), 키가 범위 밖 위험 동작을 부르면 여기서 사람이 결정한다 */
export const API_APPROVAL = {
  title: '승인 요청',
  description: 'API 키가 범위 밖의 동작을 요청했습니다. 내용을 보고 실행할지 정하세요',
  action: '동작',
  requiredScope: '필요한 범위',
  path: '경로',
  payload: '보낸 값',
  requestedAt: '요청 시각',
  expiresAt: '만료 시각',
  status: '상태',
  approve: '승인하고 실행',
  reject: '거절',
  confirmTitle: '이 동작을 실행할까요',
  confirmBody: '승인하면 키 주인의 권한으로 지금 바로 실행됩니다. 되돌릴 수 없는 동작일 수 있습니다',
  notFound: '승인 요청을 찾을 수 없거나 볼 권한이 없습니다',
  resultStatus: '실행 결과 코드',
  back: 'API 키',
} as const

export const API_APPROVAL_STATUS: Record<string, string> = {
  PENDING: '기다리는 중',
  APPROVED: '승인됨',
  REJECTED: '거절됨',
  EXPIRED: '만료됨',
  FAILED: '실행 실패',
}

export const API_APPROVAL_ERROR: Record<string, string> = {
  not_found: '승인 요청을 찾을 수 없습니다',
  forbidden: '키 주인이나 관리자만 결정할 수 있습니다',
  not_pending: '이미 결정된 요청입니다',
  expired: '만료된 요청이라 실행하지 않았습니다',
  not_mounted: '이 동작은 더 이상 API 로 부를 수 없습니다',
  invalid: '요청이 올바르지 않습니다',
  unauthorized: '다시 로그인해 주세요',
}

/** 개발자센터의 CLI 명령 절 (P0158 I08), 목록은 정의 표 생성물에서 온다 */
export const API_CLI_DOC = {
  nav: 'CLI 명령',
  title: 'teamda CLI 명령',
  description: '웹에서 하는 동작마다 같은 이름의 CLI 명령이 있습니다. teamda sync 로 서버의 최신 목록을 받습니다',
  loading: '명령 목록을 불러오는 중',
  failed: '명령 목록을 불러오지 못했습니다. 새로고침해 주세요',
  search: '명령 검색',
  command: '명령',
  scope: '범위',
  path: '경로',
  total: '전체',
} as const
