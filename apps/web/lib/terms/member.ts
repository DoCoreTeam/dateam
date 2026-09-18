/**
 * 재직의 말 — SSOT (용어집 §0-2)
 *
 * **왜 여기 두나**: 「퇴사」는 한 화면의 낱말이 아니다. 구성원 목록의 배지, 구성원 상세의
 * 제목, 조직도의 표시, 확인 문구가 전부 같은 말을 해야 한다. 화면마다 문자열을 적으면
 * 어디는 「퇴사」, 어디는 「퇴직」, 어디는 「비활성」이 되고, 사용자는 그것을 **다른 상태**로 읽는다.
 *
 * **「삭제」와 섞지 않는다.** 삭제는 「없던 것으로 친다」이고 퇴사는 「있었고 나갔다」다.
 * 퇴사한 사람이 쓴 일일업무와 주간보고는 그대로 남아 있어야 하므로, 화면에서도 두 말이
 * 서로를 대신하면 안 된다 (사용자 지시 2026-09-17).
 */

export type EmploymentStatus = 'active' | 'resigned'

export interface EmploymentStatusMeta {
  /** 화면에 보이는 말 */
  label: string
  /** 그래서 무슨 뜻인가 — title·aria-label 에 그대로 넣는다 */
  meaning: string
  /** 배지 클래스 접미사 (`badge-*`) */
  tone: 'slate' | 'green'
}

export const EMPLOYMENT_STATUS: Record<EmploymentStatus, EmploymentStatusMeta> = {
  active: { label: '재직', meaning: '아직 함께 일하는 구성원', tone: 'green' },
  resigned: { label: '퇴사', meaning: '회사를 떠난 구성원, 남긴 기록은 그대로 있음', tone: 'slate' },
}

/** 재직 기록의 칸 이름 — 구성원 상세와 목록이 같은 말을 쓴다 */
export const EMPLOYMENT_FIELD = {
  hiredOn: '입사일',
  resignedOn: '퇴사일',
  resignReason: '퇴사 사유',
  note: '메모',
} as const

/** 재직 기록을 다루는 동작 이름 */
export const EMPLOYMENT_ACTION = {
  resign: '퇴사 처리',
  undoResign: '퇴사 취소',
  save: '저장',
} as const

/** 값이 아직 없는 자리에 쓰는 말 — 「없음」이 아니다, 모르는 것과 없는 것은 다르다 */
export const EMPLOYMENT_UNKNOWN = '모름'

/** 퇴사 확인 문구 — 무엇이 남고 무엇이 막히는지 한 문장으로 말한다 */
export function confirmResign(name: string): string {
  return `${name} 님을 퇴사 처리합니다. 로그인이 막히고 조직도에서 빠지지만 그동안 쓴 기록은 그대로 남습니다`
}

/** 퇴사 취소 문구 */
export function confirmUndoResign(name: string): string {
  return `${name} 님의 퇴사를 취소합니다. 다시 로그인할 수 있게 되지만 조직도 자리는 직접 다시 넣어야 합니다`
}

/**
 * 퇴사자 탭의 말.
 *
 * 왜 거르개가 아니라 탭인가 (사용자 지적 2026-09-18): 목록은 이름순이 기본이라 퇴사자가
 * 재직자 사이사이에 끼어 나온다. 이름을 훑는 일이 그때마다 끊긴다. 거르개는 「누가 눌러 줘야
 * 동작하는 것」이고, 여기서 필요한 것은 **기본이 재직자**인 목록이다.
 *
 * 탭과 거르개를 함께 두지 않는다 — 같은 뜻의 조작이 둘이면 사용자는 어느 쪽이 이겼는지 모른다.
 */
export const RESIGNED_TAB = {
  label: '퇴사자',
  /** 퇴사일이 잡혔지만 아직 안 온 사람 — 재직 목록에 있으면서 곧 나간다 */
  scheduledLabel: '퇴사 예정',
  emptyTitle: '퇴사 처리한 구성원이 아직 없어요',
  emptyDescription: '사용자 관리에서 퇴사 처리를 하면 여기로 옮겨집니다',
} as const
