/**
 * CRM 역할의 이름과 설명 — 화면과 서버가 함께 읽는다 (P0184 I15)
 *
 * 서비스 파일(services/member.ts)에 두면 그것을 import 하는 화면이 DB 연결과 등급 판정
 * (node:async_hooks)까지 브라우저 묶음에 끌고 와 빌드가 깨진다. 연결이 없는 이 자리에 둔다.
 */

import type { CrmRole } from '../auth/requireCrmMember.ts'

export const ROLES: CrmRole[] = ['OWNER', 'ADMIN', 'MEMBER', 'READONLY']

export const ROLE_LABEL: Record<CrmRole, string> = {
  OWNER: '소유자',
  ADMIN: '관리자',
  MEMBER: '멤버',
  READONLY: '보기만',
}

export const ROLE_HINT: Record<CrmRole, string> = {
  OWNER: '모든 것을 할 수 있고, 워크스페이스를 책임집니다',
  ADMIN: '설정·멤버·파이프라인을 바꿀 수 있습니다',
  MEMBER: '회사·인물·딜을 만들고 고칠 수 있습니다',
  READONLY: '보기만 하고 바꾸지는 못합니다',
}
