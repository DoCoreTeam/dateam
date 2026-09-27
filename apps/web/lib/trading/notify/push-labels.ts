/**
 * 알림 받기 화면이 쓰는 말 — **화면 파일 안에 두지 않는다**
 *
 * 라벨 표가 화면에 있으면 같은 개념이 화면마다 다른 말이 된다
 * (`lib/ui/glossary.test.ts` 가 화면 안 라벨 표가 늘어나는 것을 막는다).
 */

/** 왜 이 기기가 알림을 못 받나. 조치가 다른 것끼리만 가른다 */
export type PushBlockReason =
  | 'unsupported'
  | 'permission_denied'
  | 'no_key'
  | 'insecure_context'
  | 'subscribe_failed'

export const PUSH_PANEL_TITLE = '알림 받기'

export const PUSH_BLOCK_LABEL: Record<PushBlockReason, string> = {
  unsupported: '이 브라우저는 알림을 지원하지 않습니다',
  permission_denied: '알림이 차단돼 있습니다',
  no_key: '알림 열쇠가 아직 만들어지지 않았습니다',
  insecure_context: '보안 연결에서만 알림을 켤 수 있습니다',
  subscribe_failed: '기기를 등록하지 못했습니다',
}

/** 무엇을 하면 되나. 사실만 적고 언제 될지는 약속하지 않는다 */
export const PUSH_BLOCK_REMEDY: Record<PushBlockReason, string> = {
  unsupported: '아이폰은 홈 화면에 추가한 뒤에 열면 알림을 켤 수 있습니다',
  permission_denied: '브라우저 주소창의 자물쇠에서 이 사이트의 알림을 허용해 주세요',
  no_key: '아래 열쇠 만들기를 누르면 이 서버의 발송 열쇠가 한 번 만들어집니다',
  insecure_context: 'https 주소로 열어 주세요',
  subscribe_failed: '잠시 뒤 다시 눌러 주세요',
}

export const PUSH_ON_LABEL = '이 기기로 알림을 받습니다'
export const PUSH_OFF_LABEL = '이 기기는 아직 알림을 안 받습니다'
export const PUSH_SUBSCRIBE_LABEL = '이 기기로 받기'
export const PUSH_UNSUBSCRIBE_LABEL = '이 기기에서 끄기'
export const PUSH_MAKE_KEY_LABEL = '열쇠 만들기'

/** 알림이 대기 표에서 끝나던 동안 무슨 일이 있었나. 켜기 전에 읽는 문장이다 */
export const PUSH_WHY =
  '등록된 기기가 없으면 신호와 경고가 화면에만 남습니다. 보고 있지 않은 동안 난 신호는 지나갑니다'
