/**
 * 기능 정의, 웹 API 문서 CLI 가 함께 읽는 한 줄
 *
 * 동작 하나(라우트 메서드 하나 또는 서버 액션 하나)마다 정의 한 줄이 있어야 한다
 * 없으면 scripts/cli-parity-check.mjs 가 실패하고 CI cli-parity 가 병합을 막는다
 * 처리 로직은 여기 두지 않는다, 화면이 쓰는 그 함수를 관문이 그대로 부른다
 */

/** 키 범위, 실제 권한은 계정 권한과 키 범위의 교집합 */
export type Scope = 'read' | 'write' | 'approve' | 'send' | 'delete' | 'admin'

export const SCOPES: readonly Scope[] = ['read', 'write', 'approve', 'send', 'delete', 'admin']

/** 범위가 없으면 바로 실행하지 않고 사람 승인을 받는 범위 */
export const APPROVAL_SCOPES: readonly Scope[] = ['approve', 'send', 'delete', 'admin']

export interface ActionDef {
  /** 추출기 키, "GET /api/crm/deals" 또는 "action app/(member)/daily/actions.ts#saveDailyLog" */
  op: string
  /** 기능 이름, crm.quote.approve 꼴 */
  name: string
  /** 필요한 범위, 없으면 정의가 아님 */
  scope: Scope
  /** CLI 명령, "crm quote approve" 꼴 (teamda 뒤) */
  cli: string
  /** 사람이 읽는 설명, 비면 라우트 머리 주석이나 함수 주석을 씀 */
  summary?: string
  /** CLI 별칭 */
  aliases?: string[]
  /** 표 출력에 쓸 칸 */
  table?: string[]
  /** 웹에만 두는 사유, 인증 화면만 허용 */
  webOnly?: string
  /** 이관 중이라 CLI 명령을 만들지 않는 사유 */
  legacy?: string
  /** 사람이 누르지 않는 기계 창구 (크론 워커) */
  machine?: string
}
