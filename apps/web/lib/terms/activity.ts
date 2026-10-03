/**
 * 활동의 말 — SSOT (용어집 §03)
 *
 * **왜 여기인가**: 활동 종류의 이름이 `components/ui/crm/Timeline.tsx` 안에 **두 벌**
 * 있었다(그리는 표 하나, 고르는 목록 하나). 그 화면은 딜·회사·인물 상세 안쪽에만 있었고,
 * 활동을 목록으로 보는 화면이 생기면서 세 벌이 될 자리였다. 같은 종류를 한쪽에서만
 * 고치면 「통화」가 어떤 화면에서는 「전화」가 되는 날이 온다.
 *
 * **종류를 사람이 늘리지 않는다.** 서비스의 `ActivityType` 과 한 벌로 묶여 있고,
 * 늘리려면 저장되는 값(`crm_activity.type`)이 먼저 있어야 한다.
 */

/** 활동 종류 다섯. 저장값과 같은 글자다 */
export type ActivityTypeKey = 'NOTE' | 'CALL' | 'MEETING' | 'EMAIL' | 'SYSTEM'

export const ACTIVITY_TYPE_LABEL: Record<ActivityTypeKey, string> = {
  NOTE: '노트',
  CALL: '통화',
  MEETING: '미팅',
  EMAIL: '메일',
  SYSTEM: '시스템',
}

/**
 * 고르는 칸에 서는 순서 — **사람이 남기는 것부터**.
 *
 * 시스템이 맨 뒤다. 사람이 「누가 몇 번 접촉했나」를 물을 때 시스템 기록은 답이 아니다.
 */
export const ACTIVITY_TYPE_ORDER: readonly ActivityTypeKey[] = ['NOTE', 'CALL', 'MEETING', 'EMAIL', 'SYSTEM']

/** 사람이 직접 남길 수 있는 종류. 메일과 시스템은 연동·시스템이 만든다 */
export const ACTIVITY_MANUAL_TYPES: readonly ActivityTypeKey[] = ['NOTE', 'CALL', 'MEETING']

/**
 * 어디에 붙은 기록인지 말하는 자리.
 *
 * **「없음」이라고만 쓰지 않는다.** 활동은 회사·인물·딜 중 하나에 붙어야 만들어지므로
 * 붙은 데가 없는 줄은 **그 대상이 지워진** 것이다. 「없음」은 안 채운 것으로 읽히고,
 * 지워진 것과 안 채운 것은 사람이 해야 할 일이 다르다.
 */
export const ACTIVITY_NO_ANCHOR = '붙은 대상이 지워졌어요'

/**
 * 거르는 칸의 이름 둘.
 *
 * **「담당자」라고 쓰지 않는다.** 활동을 남긴 사람과 딜의 담당자는 다른 사람일 수 있다
 * (영업이 만든 딜에 지원 인력이 통화 기록을 남긴다). 「담당자」로 적으면 딜 담당자로
 * 거르는 줄 알고 그 숫자를 담당자별 실적으로 읽는다.
 *
 * 기간 칸의 이름은 용어집의 `REPORT.period` 를 그대로 쓴다 — 리포트와 같은 말이다.
 */
export const ACTIVITY_AUTHOR = '남긴 사람'
export const ACTIVITY_TYPE_FIELD = '종류'

/**
 * 이어 읽는 단추.
 *
 * 타임라인이 이미 「이전 기록 더 보기」를 쓴다. 목록은 조건으로 거른 결과를 이어 읽는
 * 자리라 「이전」이 아니라 그냥 더 받는 것이므로 짧은 쪽을 쓰고, 두 자리가 같은
 * 뒷말(「더 보기」)을 쓰게 맞춘다.
 */
export const ACTIVITY_MORE = '더 보기'

/** 시스템이 남긴 기록임을 밝히는 줄. 사람이 쓴 말과 섞이지 않게 */
export const ACTIVITY_SYSTEM_NOTE = '시스템이 남긴 기록입니다'
