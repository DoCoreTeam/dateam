/**
 * 「누구 것을 볼 것인가」의 말 — SSOT
 *
 * 오늘 화면과 목록이 **같은 탭 이름**을 쓴다. 화면마다 따로 적으면 같은 조건이
 * 여기서는 「내 담당」이고 저기서는 「나」가 되고, 사용자는 둘이 같은 것인지 모른다.
 * 부서 업무 위젯이 이미 「내 담당 · 부서 전체」로 부르고 있어 그 말을 그대로 쓴다.
 */

/** 화면이 그릴 수 있는 탭 — 판정은 lib/crm/services/my-scope-decide.ts 가 한다 */
export type ScopeTabKey = 'mine' | 'dept' | 'all'

export const SCOPE_TAB_LABEL: Record<ScopeTabKey, string> = {
  mine: '내 담당',
  dept: '부서 전체',
  all: '전체',
}

/** 모르는 값이 와도 화면이 안 멈춘다 — 이름을 지어내지 않고 온 값을 그대로 보인다 */
export function scopeTabLabel(id: string): string {
  return SCOPE_TAB_LABEL[id as ScopeTabKey] ?? id
}

/**
 * 좁혀 보다 비었을 때 하는 말.
 *
 * **「없다」와 「내 것이 없다」는 다른 말이다.** 기본이 내 담당인데 빈 목록에
 * 「등록된 회사가 아직 없어요」라고 쓰면, 회사가 382곳 있는데도 하나도 없다고 말하는 것이다
 * (실측 2026-09-23: 담당자가 붙은 행이 아직 하나도 없어 세 목록이 전부 기본에서 빈다).
 *
 * 무엇을 세는지 말하지 않는다 — 회사·인물·딜에 같은 문장을 쓰려면 조사가 붙으면 안 된다(§0-2).
 */
export const SCOPE_EMPTY = {
  title: '내 담당이 아직 없어요',
  description: '지금은 내 담당만 보고 있어요. 위 탭에서 전체를 고르면 모두 보입니다.',
} as const
