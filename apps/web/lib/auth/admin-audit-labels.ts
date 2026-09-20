/**
 * 관리자 행위의 이름과 화면 문구 — 순수 값만 둔다
 *
 * `admin-audit.ts` 와 나눈 이유: 그쪽은 `server-only` 를 물고 있어 테스트 러너가 못 읽는다.
 * 이름과 문구가 어긋나는 것은 가장 흔한 실수인데 그것을 못 재면 가드가 소용없다.
 */

export type AdminAction =
  | 'role_change'
  | 'user_delete'
  | 'password_reset'
  | 'mfa_reset'
  | 'member_resign'
  | 'member_unresign'
  | 'user_invite'

/** 화면과 보고서가 같은 말을 쓰게 한다. */
export const ADMIN_ACTION_LABEL: Record<AdminAction, string> = {
  role_change: '역할 변경',
  user_delete: '계정 삭제',
  password_reset: '비밀번호 초기화',
  mfa_reset: '2단계 인증 해제',
  member_resign: '퇴사 처리',
  member_unresign: '퇴사 취소',
  user_invite: '구성원 초대',
}
