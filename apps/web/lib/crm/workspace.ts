/**
 * CRM 워크스페이스 해석 (SSOT)
 *
 * dacrm 은 데이터얼라이언스 내부 앱에 얹히는 모듈이라 워크스페이스가 **하나**다.
 * 그래도 값을 여기저기 흩뿌리지 않고 이 파일 하나로 모은다 —
 * 나중에 워크스페이스가 둘이 되는 날, 고칠 곳이 여기 하나여야 하기 때문이다.
 *
 * 시드(prisma/seed-data.ts)도 이 값을 가져다 쓴다. 반대 방향이면
 * 앱 코드가 시드에 의존하게 되는데, 시드는 개발 도구지 런타임이 아니다.
 */

/** 시드가 만드는 기본 워크스페이스 */
export const DEFAULT_CRM_WORKSPACE_ID = 'ws_dataalliance'

/**
 * 이번 요청의 워크스페이스.
 *
 * 지금은 상수를 돌려준다. 사용자가 여러 워크스페이스에 속하게 되면
 * 여기서 세션·쿠키·URL 을 보고 고르면 된다 — 호출부는 바뀌지 않는다.
 *
 * ⚠️ 클라이언트가 보낸 값을 그대로 쓰지 않는다(구현명세서 5장 공통규칙).
 *    workspaceId 는 서버가 세션에서만 해석한다.
 */
export function resolveCrmWorkspaceId(): string {
  return DEFAULT_CRM_WORKSPACE_ID
}
